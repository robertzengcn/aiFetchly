/**
 * Type declaration for the untyped `protocol-registry` dependency
 * (deep-link protocol registration in background.ts). Declaring the surface
 * here keeps the typecheck independent of whether the package currently
 * resolved in a shared node_modules tree ships its own types.
 */
declare module "protocol-registry" {
  export interface ProtocolRegisterOptions {
    override?: boolean;
    appName?: string;
    terminal?: boolean;
  }

  const ProtocolRegistry: {
    register(
      scheme: string,
      command: string,
      options?: ProtocolRegisterOptions
    ): Promise<void>;
  };

  export default ProtocolRegistry;
}
