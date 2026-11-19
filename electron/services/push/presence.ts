// What each paired phone is looking at (phone.presence frames). Per socket: a
// phone can hold more than one connection, so a device is viewing a chat when
// any of its sockets says so. A socket's presence clears when it closes.

export interface PhonePresenceState { chatId: string | null; foreground: boolean }

export class PhonePresence {
  private readonly bySock = new Map<object, PhonePresenceState & { deviceId: string }>();

  set(deviceId: string, sock: object, p: PhonePresenceState): void {
    this.bySock.set(sock, { deviceId, chatId: p.chatId, foreground: p.foreground });
  }

  /** The socket closed. */
  clear(sock: object): void {
    this.bySock.delete(sock);
  }

  /** True when one of the device's sockets has this chat open in the foreground. */
  isViewing(deviceId: string, chatId: string): boolean {
    for (const p of this.bySock.values()) {
      if (p.deviceId === deviceId && p.foreground && p.chatId === chatId) return true;
    }
    return false;
  }
}
