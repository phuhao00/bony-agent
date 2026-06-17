export interface PluginCommand {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface PluginResponse {
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface BridgeMessage {
  type: "command" | "response" | "ping" | "pong" | "connected";
  payload?: PluginCommand | PluginResponse | Record<string, unknown>;
}
