<template>
  <!--
    HTML-disabled allowlisted Markdown rendering for plan documents
    (design §15.15): raw HTML is NEVER parsed and never reaches v-html.
    Only headings, lists, code fences, paragraphs, bold/inline-code, and
    http(s) links render; unsafe schemes and embedded HTML display as text.
  -->
  <div class="safe-plan-markdown" data-testid="workspace-plan-markdown">
    <template v-for="(block, index) in blocks" :key="index">
      <h1 v-if="block.type === 'h1'">{{ block.text }}</h1>
      <h2 v-else-if="block.type === 'h2'">{{ block.text }}</h2>
      <h3 v-else-if="block.type === 'h3'">{{ block.text }}</h3>
      <pre v-else-if="block.type === 'code'"><code>{{ block.text }}</code></pre>
      <ul v-else-if="block.type === 'ul'">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <SafeInlineText :text="item" />
        </li>
      </ul>
      <ol v-else-if="block.type === 'ol'">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <SafeInlineText :text="item" />
        </li>
      </ol>
      <p v-else><SafeInlineText :text="block.text ?? ''" /></p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, type PropType } from "vue";

const props = defineProps<{
  markdown: string;
}>();

interface MdBlock {
  type: "h1" | "h2" | "h3" | "code" | "ul" | "ol" | "p";
  text?: string;
  items?: string[];
}

/** Parse block structure only — inline HTML stays inert text. */
function parseBlocks(markdown: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let listBuffer: { type: "ul" | "ol"; items: string[] } | null = null;
  let paragraphBuffer: string[] = [];

  const flushParagraph = (): void => {
    if (paragraphBuffer.length > 0) {
      blocks.push({ type: "p", text: paragraphBuffer.join(" ") });
      paragraphBuffer = [];
    }
  };
  const flushList = (): void => {
    if (listBuffer) {
      blocks.push({ type: listBuffer.type, items: listBuffer.items });
      listBuffer = null;
    }
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push({
        type: (level === 1 ? "h1" : level === 2 ? "h2" : "h3") as MdBlock["type"],
        text: heading[2],
      });
      index += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence
      blocks.push({ type: "code", text: codeLines.join("\n") });
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      flushParagraph();
      if (!listBuffer || listBuffer.type !== "ul") {
        flushList();
        listBuffer = { type: "ul", items: [] };
      }
      listBuffer.items.push(ul[1]);
      index += 1;
      continue;
    }
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      flushParagraph();
      if (!listBuffer || listBuffer.type !== "ol") {
        flushList();
        listBuffer = { type: "ol", items: [] };
      }
      listBuffer.items.push(ol[1]);
      index += 1;
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraphBuffer.push(line.trim());
    }
    index += 1;
  }
  flushParagraph();
  flushList();
  return blocks;
}

const blocks = computed(() => parseBlocks(props.markdown));

/**
 * Inline renderer: bold, inline code, and SAFE http(s) links only. Any other
 * markup (HTML tags, javascript:, data:) renders as literal text.
 */
const SafeInlineText = defineComponent({
  name: "SafeInlineText",
  props: {
    text: { type: String as PropType<string>, required: true },
  },
  setup(textProps) {
    return (): ReturnType<typeof h>[] => {
      const nodes: ReturnType<typeof h>[] = [];
      const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      const push = (node: ReturnType<typeof h>): void => {
        nodes.push(node);
      };
      while ((match = pattern.exec(textProps.text)) !== null) {
        if (match.index > lastIndex) {
          push(h("span", textProps.text.slice(lastIndex, match.index)));
        }
        const token = match[0];
        if (token.startsWith("**")) {
          push(h("strong", token.slice(2, -2)));
        } else if (token.startsWith("`")) {
          push(h("code", token.slice(1, -1)));
        } else {
          const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
          const href = link?.[2] ?? "";
          if (link && /^https?:\/\//i.test(href)) {
            // Safe scheme only; external links open via target=_blank+noopener.
            push(
              h("a", { href, target: "_blank", rel: "noopener noreferrer" }, link[1])
            );
          } else {
            push(h("span", token));
          }
        }
        lastIndex = match.index + token.length;
      }
      if (lastIndex < textProps.text.length) {
        push(h("span", textProps.text.slice(lastIndex)));
      }
      return nodes;
    };
  },
});
</script>

<style scoped>
.safe-plan-markdown {
  font-size: 12.5px;
  line-height: 1.55;
  display: flex;
  flex-direction: column;
  gap: 6px;
  word-break: break-word;
}

.safe-plan-markdown h1 {
  font-size: 15px;
  margin: 4px 0 0;
}

.safe-plan-markdown h2 {
  font-size: 13.5px;
  margin: 4px 0 0;
}

.safe-plan-markdown h3 {
  font-size: 12.5px;
  margin: 2px 0 0;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.safe-plan-markdown p {
  margin: 0;
}

.safe-plan-markdown ul,
.safe-plan-markdown ol {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.safe-plan-markdown pre {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 6px;
  padding: 8px 10px;
  overflow-x: auto;
  margin: 0;
  font-size: 11.5px;
}

.safe-plan-markdown :deep(a) {
  color: rgb(var(--v-theme-primary));
}
</style>
