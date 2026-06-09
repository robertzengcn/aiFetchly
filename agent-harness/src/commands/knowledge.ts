/**
 * Knowledge commands - manage RAG documents and chunks.
 * Uses RAGDocumentEntity, RAGChunkEntity.
 */

import { Command } from "commander";
import { CliDatabase } from "../adapter/cli-database";
import { RAGDocumentEntity } from "@/entity/RAGDocument.entity";
import { RAGChunkEntity } from "@/entity/RAGChunk.entity";
import {
  formatPaginated,
  formatItem,
  formatOutput,
  formatError,
} from "../output/formatter";
import type { TableConfig } from "../common/types";

const DOCUMENT_LIST_CONFIG: TableConfig = {
  columns: [
    { key: "id", header: "ID", width: 6 },
    { key: "name", header: "Name", width: 30 },
    { key: "fileType", header: "Type", width: 10 },
    { key: "chunkCount", header: "Chunks", width: 8 },
    { key: "createdAt", header: "Created", width: 20 },
  ],
};

const KNOWLEDGE_STATS_FIELDS = [
  { key: "totalDocuments", label: "Total Documents" },
  { key: "totalChunks", label: "Total Chunks" },
  { key: "typesBreakdown", label: "Types Breakdown" },
];

export function registerKnowledgeCommands(parent: Command): void {
  const knowledge = parent
    .command("knowledge")
    .description("Manage knowledge base documents");

  // ── knowledge list-documents ───────────────────────────────────────────
  knowledge
    .command("list-documents")
    .description("List documents")
    .option("-p, --page <number>", "Page number", "1")
    .option("-s, --size <number>", "Page size", "20")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const docRepo = CliDatabase.getRepository(RAGDocumentEntity);
        const chunkRepo = CliDatabase.getRepository(RAGChunkEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const [items, total] = await docRepo
          .createQueryBuilder("doc")
          .orderBy("doc.id", "DESC")
          .skip(skip)
          .take(size)
          .getManyAndCount();

        // Enrich each document with its chunk count
        const enrichedItems = await Promise.all(
          items.map(async (doc) => {
            const record = doc as unknown as Record<string, unknown>;
            const chunkCount = await chunkRepo.count({
              where: { documentId: record.id } as Record<string, unknown>,
            });
            return { ...record, chunkCount };
          })
        );

        formatPaginated(
          {
            items: enrichedItems,
            total,
            page,
            size,
            totalPages: Math.ceil(total / size),
          },
          opts.json,
          "knowledge:list-documents",
          DOCUMENT_LIST_CONFIG
        );
      } catch (error) {
        formatError(error, opts.json, "knowledge:list-documents");
      }
    });

  // ── knowledge stats ────────────────────────────────────────────────────
  knowledge
    .command("stats")
    .description("Get knowledge base statistics")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const docRepo = CliDatabase.getRepository(RAGDocumentEntity);
        const chunkRepo = CliDatabase.getRepository(RAGChunkEntity);

        const totalDocuments = await docRepo.count();
        const totalChunks = await chunkRepo.count();

        // Build types breakdown using raw SQL for efficiency
        const typeRows = await docRepo
          .createQueryBuilder("doc")
          .select("doc.fileType", "type")
          .addSelect("COUNT(*)", "count")
          .groupBy("doc.fileType")
          .getRawMany();

        const typesBreakdown: Record<string, number> = {};
        for (const row of typeRows) {
          typesBreakdown[row.type] = parseInt(row.count, 10);
        }

        const stats: Record<string, unknown> = {
          totalDocuments,
          totalChunks,
          typesBreakdown,
        };

        formatItem(stats, opts.json, "knowledge:stats", KNOWLEDGE_STATS_FIELDS);
      } catch (error) {
        formatError(error, opts.json, "knowledge:stats");
      }
    });

  // ── knowledge search <query> ───────────────────────────────────────────
  knowledge
    .command("search <query>")
    .description(
      "Search documents by text content (simple text search on chunks)"
    )
    .option("--json", "Output as JSON")
    .action(async (query, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const chunkRepo = CliDatabase.getRepository(RAGChunkEntity);
        const docRepo = CliDatabase.getRepository(RAGDocumentEntity);

        // Simple LIKE-based text search on chunk content
        const chunks = await chunkRepo
          .createQueryBuilder("chunk")
          .where("chunk.content LIKE :query", { query: `%${query}%` })
          .orderBy("chunk.documentId", "ASC")
          .addOrderBy("chunk.chunkIndex", "ASC")
          .getMany();

        if (chunks.length === 0) {
          formatError(
            new Error(`No documents found matching: ${query}`),
            opts.json,
            "knowledge:search"
          );
          return;
        }

        // Collect unique document IDs and fetch corresponding documents
        const docIds = [
          ...new Set(
            chunks.map(
              (c) =>
                (c as unknown as Record<string, unknown>).documentId as number
            )
          ),
        ];
        const docs = await docRepo
          .createQueryBuilder("doc")
          .where("doc.id IN (:...docIds)", { docIds })
          .getMany();

        // Build results grouped by document
        const results = docs.map((doc) => {
          const docRecord = doc as unknown as Record<string, unknown>;
          const matchingChunks = chunks.filter(
            (c) =>
              (c as unknown as Record<string, unknown>).documentId ===
              docRecord.id
          );
          return {
            id: docRecord.id,
            name: docRecord.name,
            fileType: docRecord.fileType,
            matchedChunks: matchingChunks.length,
            preview:
              (
                matchingChunks[0] as unknown as
                  | Record<string, unknown>
                  | undefined
              )?.content ?? "",
          };
        });

        formatOutput(results, opts.json, "knowledge:search", {
          columns: [
            { key: "id", header: "ID", width: 6 },
            { key: "name", header: "Document", width: 25 },
            { key: "fileType", header: "Type", width: 10 },
            { key: "matchedChunks", header: "Matches", width: 10 },
            { key: "preview", header: "Preview", width: 40 },
          ],
        });
      } catch (error) {
        formatError(error, opts.json, "knowledge:search");
      }
    });
}
