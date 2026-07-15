declare module '@earendil-works/pi-coding-agent' {
  export type CommandHandler = (
    args: any,
    ctx: any,
  ) => unknown | Promise<unknown>;

  export function getMarkdownTheme(): any;

  export type ExtensionAPI = {
    on(
      event: string,
      handler: (event: any, ctx: any) => unknown | Promise<unknown>,
    ): void;
    registerCommand(
      name: string,
      config: { description?: string; handler: CommandHandler },
    ): void;
    registerMessageRenderer?(
      customType: string,
      renderer: (message: any, options: any, theme: any) => unknown,
    ): void;
    sendMessage(
      message: {
        customType: string;
        content: string | unknown[];
        display: boolean;
        details?: unknown;
      },
      options?: Record<string, unknown>,
    ): void;
    appendEntry(type: string, data: unknown): void;
    sendUserMessage(message: string, options?: Record<string, unknown>): void;
  };
}
