import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { Order } from "./order.decorator";

@Entity("mcp_tool")
@Index(["serverName"])
@Index(["enabled"])
export class MCPToolEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("text", { nullable: false })
  serverName: string;

  @Order(2)
  @Column("text", { nullable: true })
  host?: string;

  @Order(3)
  @Column("integer", { nullable: true })
  port?: number;

  @Order(4)
  @Column("text", { nullable: false, default: "stdio" })
  transport: "stdio" | "sse" | "websocket";

  @Order(5)
  @Column("boolean", { nullable: false, default: true })
  enabled: boolean;

  @Order(6)
  @Column("text", { nullable: false, default: "none" })
  authType: "none" | "api_key" | "bearer_token" | "custom";

  @Order(7)
  @Column("text", { nullable: true })
  authConfig?: string; // JSON string storing authentication details

  @Order(8)
  @Column("integer", { nullable: false, default: 30000 })
  timeout: number; // Request timeout in milliseconds

  @Order(9)
  @Column("text", { nullable: true })
  tools?: string; // JSON string array of tool names available from this server

  @Order(10)
  @Column("text", { nullable: true })
  toolConfig?: string; // JSON object mapping tool names to their enable/disable status and custom config

  @Order(11)
  @Column("text", { nullable: true })
  metadata?: string; // JSON string for additional server metadata (version, description, etc.)

  // --- Plugin ownership + stdio fields (Design §5.3, §9.2) ---

  /** Owner plugin name. null = standalone MCP server. */
  @Index()
  @Order(12)
  @Column("text", { nullable: true })
  pluginName?: string;

  /** Relative path of the MCP component file inside the owning plugin. */
  @Order(13)
  @Column("text", { nullable: true })
  pluginComponentPath?: string;

  /** Stdio command (e.g. "npx"). Used when transport === "stdio" for plugin rows. */
  @Order(14)
  @Column("text", { nullable: true })
  command?: string;

  /** JSON-stringified readonly string[] of command args. */
  @Order(15)
  @Column("text", { nullable: true })
  argsJson?: string;

  /** JSON-stringified env metadata (placeholders, non-secret defaults). */
  @Order(16)
  @Column("text", { nullable: true })
  envJson?: string;

  /** Full URL for sse/websocket transports when provided by a plugin. */
  @Order(17)
  @Column("text", { nullable: true })
  url?: string;

  /** Provenance: "manual" (user-added) vs "plugin" (installed via plugin). */
  @Order(18)
  @Column("text", { default: "manual" })
  origin: "manual" | "plugin";
}
