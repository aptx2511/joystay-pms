export type ChannelName = "zalo" | "messenger" | "instagram" | "whatsapp" | "web" | "test";

export interface OutboundAdapter {
  sendText(userId: string, text: string): Promise<void>;
  sendImage(userId: string, imageUrl: string, caption?: string): Promise<void>;
}

export interface InboundMessage {
  channel: ChannelName;
  userId: string;
  text: string;
  userName?: string;
}
