import type { AvatarEmote, LoungeChatMessage, LoungeMember, PlatformMode, LoyaltyRank } from '../types';
import type { LocomotionMoveState } from './locomotion';

export interface MultiplayerSyncHandlers {
  onInit: (members: LoungeMember[]) => void;
  onUserJoined: (member: LoungeMember) => void;
  onUserMoved: (patch: {
    clientId: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    emote: AvatarEmote;
    moveState: LocomotionMoveState;
    speed: number;
  }) => void;
  onUserUpdated: (member: LoungeMember) => void;
  onUserLeft: (clientId: string) => void;
  onChatMessage: (msg: LoungeChatMessage) => void;
  onConnectionChange: (online: boolean) => void;
}

export class MultiplayerCharacterSync {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private closed = false;
  private lastMoveSendMs = 0;

  constructor(
    private readonly selfClientId: string,
    private readonly getJoinPayload: () => {
      uid: string;
      displayName: string;
      handle: string;
      platform: PlatformMode;
      loyaltyRank: LoyaltyRank;
      equippedAvatarId: string;
      emote: AvatarEmote;
      x: number;
      y: number;
      z: number;
      yaw: number;
    },
    private readonly handlers: MultiplayerSyncHandlers,
  ) {}

  public connect(): void {
    if (this.closed) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.handlers.onConnectionChange(true);
        const jp = this.getJoinPayload();
        ws.send(
          JSON.stringify({
            type: 'lounge:join',
            payload: {
              clientId: this.selfClientId,
              ...jp,
              moveState: 'idle',
              speed: 0,
            },
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data));
          if (data.type === 'lounge:init' && Array.isArray(data.members)) {
            this.handlers.onInit(data.members as LoungeMember[]);
          } else if (data.type === 'user:joined' && data.member) {
            this.handlers.onUserJoined(data.member as LoungeMember);
          } else if (data.type === 'user:moved') {
            this.handlers.onUserMoved({
              clientId: String(data.clientId || ''),
              x: Number(data.x) || 0,
              y: Number(data.y) || 0,
              z: Number(data.z) || 0,
              yaw: Number(data.yaw) || 0,
              emote: (data.emote as AvatarEmote) || 'idle',
              moveState: (data.moveState as LocomotionMoveState) || 'idle',
              speed: Number(data.speed) || 0,
            });
          } else if (data.type === 'user:updated' && data.member) {
            this.handlers.onUserUpdated(data.member as LoungeMember);
          } else if (data.type === 'user:left' && data.clientId) {
            this.handlers.onUserLeft(String(data.clientId));
          } else if (data.type === 'chat:message') {
            this.handlers.onChatMessage(data as LoungeChatMessage);
          }
        } catch {
          // Ignore malformed message
        }
      };

      ws.onclose = () => {
        this.handlers.onConnectionChange(false);
        if (!this.closed) {
          this.reconnectTimer = window.setTimeout(() => this.connect(), 2600);
        }
      };

      ws.onerror = () => {
        this.handlers.onConnectionChange(false);
      };
    } catch {
      this.handlers.onConnectionChange(false);
    }
  }

  public sendMove(payload: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    emote: AvatarEmote;
    moveState: LocomotionMoveState;
    speed: number;
  }): void {
    const now = performance.now();
    if (now - this.lastMoveSendMs < 66) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.lastMoveSendMs = now;
    this.ws.send(
      JSON.stringify({
        type: 'lounge:move',
        payload: {
          x: Number(payload.x.toFixed(3)),
          y: Number(payload.y.toFixed(3)),
          z: Number(payload.z.toFixed(3)),
          yaw: Number(payload.yaw.toFixed(3)),
          emote: payload.emote,
          moveState: payload.moveState,
          speed: Number(payload.speed.toFixed(2)),
        },
      }),
    );
  }

  public sendState(payload: {
    displayName: string;
    platform: PlatformMode;
    loyaltyRank: LoyaltyRank;
    equippedAvatarId: string;
    emote: AvatarEmote;
  }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'lounge:state', payload }));
  }

  public sendChat(text: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: 'lounge:chat', payload: { text } }));
    return true;
  }

  public dispose(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
