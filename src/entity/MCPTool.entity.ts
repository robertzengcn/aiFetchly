import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { Order } from "./order.decorator";

@Entity("mcp_tool")
@Index(['serverName'])
@Index(['enabled'])
export class MCPToolEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Order(1)
    @Column("text", { nullable: false })
    serverName: string;

    @Order(2)
    @Column("text", { nullable: false })
    host: string;

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
}


