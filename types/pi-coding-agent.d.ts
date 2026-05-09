declare module "@earendil-works/pi-coding-agent" {
  export type CommandHandler = (args: any, ctx: any) => unknown | Promise<unknown>;

  export type ExtensionAPI = {
    on(event: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>): void;
    registerCommand?(name: string, config: { description?: string; handler: CommandHandler }): void;
    appendEntry?(type: string, data: unknown): void;
    sendUserMessage?(message: string, options?: Record<string, unknown>): void;
  };
}
