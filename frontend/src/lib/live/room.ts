// The live room connection, shared by the student and the examiner.
//
// One WebSocket to the backend carries: JSON messages (state, transcript, flags, questions …),
// the WebRTC handshake for the video call, and binary media for the AI engines
// (byte 0x01 + JPEG frame, byte 0x02 + 16 kHz 16-bit PCM audio).
// The call itself is peer-to-peer WebRTC; the examiner always makes the offer, the student answers.

import { liveRoomUrl } from "@/lib/api/vivas";

export type Role = "student" | "examiner";
export type LiveMessage = { type: string; [key: string]: unknown };

export const FRAME = 0x01;
export const AUDIO = 0x02;

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
// Close codes from the server that mean "don't retry".
const FINAL_CLOSE = new Set([4401, 4403, 4409]);

export interface RoomHandlers {
  onMessage: (msg: LiveMessage) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
  onConnection: (state: "connecting" | "open" | "closed", reason?: string) => void;
}

export class LiveRoom {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private retry = 0;
  private closed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private vivaId: string,
    private studentId: string,
    private role: Role,
    private local: MediaStream,
    private handlers: RoomHandlers,
  ) {}

  connect() {
    this.handlers.onConnection("connecting");
    const ws = new WebSocket(liveRoomUrl(this.vivaId, this.studentId));
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.handlers.onConnection("open");
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const msg = JSON.parse(e.data) as LiveMessage;
      if (msg.type === "signal") void this.onSignal(msg.data as Record<string, unknown>);
      else this.onRoomMessage(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closed || FINAL_CLOSE.has(e.code)) {
        this.handlers.onConnection("closed", e.reason || undefined);
        return;
      }
      // Network blip: try again with backoff.
      this.handlers.onConnection("connecting");
      this.retryTimer = setTimeout(() => this.connect(), Math.min(8000, 500 * 2 ** this.retry++));
    };
  }

  close() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.pc?.close();
    this.pc = null;
  }

  get bufferedAmount() {
    return this.ws?.bufferedAmount ?? 0;
  }

  send(msg: LiveMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendBinary(tag: number, payload: ArrayBuffer) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const out = new Uint8Array(payload.byteLength + 1);
    out[0] = tag;
    out.set(new Uint8Array(payload), 1);
    this.ws.send(out);
  }

  private onRoomMessage(msg: LiveMessage) {
    // The examiner (re)starts the call whenever the student is (back) online.
    if (this.role === "examiner") {
      const studentOnline =
        (msg.type === "state" && msg.studentOnline === true) || (msg.type === "presence" && msg.student === true);
      if (studentOnline) void this.call();
      if (msg.type === "presence" && msg.student === false) this.hangUp();
    } else if (msg.type === "presence" && msg.examiner === false) {
      this.hangUp();
    }
    this.handlers.onMessage(msg);
  }

  private hangUp() {
    this.pc?.close();
    this.pc = null;
    this.handlers.onRemoteStream(null);
  }

  private newPeer(): RTCPeerConnection {
    this.pc?.close();
    this.pendingIce = [];
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.local.getTracks().forEach((t) => pc.addTrack(t, this.local));
    pc.ontrack = (e) => this.handlers.onRemoteStream(e.streams[0] ?? new MediaStream([e.track]));
    pc.onicecandidate = (e) => e.candidate && this.send({ type: "signal", data: { candidate: e.candidate.toJSON() } });
    this.pc = pc;
    return pc;
  }

  private async call() {
    const pc = this.newPeer();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: "signal", data: { sdp: pc.localDescription?.toJSON() } });
  }

  private async onSignal(data: Record<string, unknown>) {
    try {
      if (data.sdp) {
        const sdp = data.sdp as RTCSessionDescriptionInit;
        if (sdp.type === "offer" && this.role === "student") {
          const pc = this.newPeer();
          await pc.setRemoteDescription(sdp);
          await this.flushIce();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.send({ type: "signal", data: { sdp: pc.localDescription?.toJSON() } });
        } else if (sdp.type === "answer" && this.role === "examiner" && this.pc) {
          await this.pc.setRemoteDescription(sdp);
          await this.flushIce();
        }
      } else if (data.candidate) {
        const c = data.candidate as RTCIceCandidateInit;
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(c);
        else this.pendingIce.push(c);
      }
    } catch (err) {
      console.warn("[live] signalling failed", err);
    }
  }

  private async flushIce() {
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const c of queued) await this.pc?.addIceCandidate(c);
  }
}
