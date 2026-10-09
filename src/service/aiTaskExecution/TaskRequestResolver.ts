/**
 * Conservative request intent resolution (FR-18).
 *
 * Routes each accepted manual/scheduled submission to one of:
 *   response_only    — ordinary answer; ends naturally (no task badge)
 *   task_verified    — actionable task with an approved template/contract
 *   task_best_effort — actionable task without a complete verified contract
 *   preparation      — planning/approval/input wait; cannot finish work
 *
 * Rules (FR-18):
 *   - Do NOT use punctuation, keyword matching, or "tools were called" alone.
 *   - A "check latest status" request is a task (retrieval/report required)
 *     even though it resembles a question. A definition question is not.
 *   - An assistant promise, tool result, quoted instruction, attachment,
 *     selected history, runtime nudge, or renderer system prompt CANNOT
 *     independently authorize work. Only the actual user message + approved
 *     references source the objective.
 *   - Classifier outputs are advisory; ambiguity → clarification/best-effort,
 *     never an invented target (AC-21).
 *
 * Slice 1 implements the deterministic structural classifier. The optional
 * model-assisted classifier is advisory only and lands in Slice 2; its
 * failure cannot silently downgrade an actionable request.
 */
import type { TaskExecutionRoute } from "@/entityTypes/aiTaskExecutionTypes";

export interface ResolveInput {
  readonly userMessage: string;
  readonly hasApprovedTaskTemplate: boolean;
  readonly pendingPlanApproval?: boolean;
  readonly pendingPermission?: boolean;
}

/**
 * Leading politeness/preamble prefixes that must not defeat verb detection.
 * "Please check the deployment status now" is a fresh-information task, not
 * response_only — the previous startsWith-only matcher misrouted it because
 * it began with "please " instead of "check " (FR-17, AC-19).
 */
const POLITE_PREFIXES = [
  "please ",
  "could you ",
  "can you ",
  "would you ",
  "kindly ",
  "i need you to ",
  "i want you to ",
] as const;

/**
 * Imperative verbs that indicate a material action on a target — save,
 * collect, find, search, gather, add, import — beyond the original
 * send/post/publish/deploy set. "Save 100 qualifying contacts" must enroll
 * as a task even without an approved template (FR-17). FR-18 forbids
 * keyword-only matching, so these are matched as whole imperative leads
 * (word boundary), not as substrings anywhere in the message.
 */
const ACTION_VERBS = [
  "send",
  "post",
  "publish",
  "deploy",
  "save",
  "collect",
  "find",
  "search",
  "gather",
  "add",
  "import",
  "export",
  "extract",
  "scrape",
  "fetch",
] as const;

const RETRIEVAL_VERBS = [
  "check",
  "monitor",
  "verify",
  "get the latest",
  "get the status",
  "check the latest",
  "check the current",
] as const;

const DELIVERABLE_VERBS = [
  "write",
  "draft",
  "compose",
  "generate",
  "create a",
  "summarize",
] as const;

const DEFINITION_STARTERS = [
  "what is",
  "what's",
  "what does it mean",
  "how does",
  "why is",
  "explain",
] as const;

/**
 * Fresh-state signals inside a question form. A question that opens with a
 * definition stem ("what is ...") but asks for a CURRENT/external state is a
 * fresh-information task (retrieval/report required), not a definition:
 * "What is the latest deployment status?" must enroll; "What is a
 * deployment?" must not (T18, FR-17/18, AC-19).
 */
const FRESH_STATE_SIGNALS = [
  "status",
  "latest",
  "current",
  "progress",
  "now",
  "update",
] as const;

/**
 * CJK (Chinese/Japanese) polite-request prefixes — the CJK equivalent of
 * POLITE_PREFIXES. "请保存100个联系人" strips to "保存100个联系人" so the
 * CJK verb detection sees the imperative (T18, FR-17).
 */
const CJK_POLITE_PREFIXES = [
  "请", // please
  "麻烦你", // trouble you to
  "麻烦", // trouble to
  "请帮我", // please help me
  "请你", // please you
  "帮我", // help me
  "帮我", // duplicate guard is harmless
  "してください", // Japanese "...please do"
  "てください", // Japanese "...please"
] as const;

/**
 * CJK action verbs (Chinese simplified + Japanese kanji forms) that indicate
 * a material action on a target — the CJK equivalent of ACTION_VERBS.
 * Matched as whole leading stems (T18, FR-17/18). English-only matching
 * never sees these, so CJK material tasks silently bypassed enrollment
 * before T18.
 */
const CJK_ACTION_VERBS = [
  "保存", // save
  "收集", // collect
  "采集", // collect/gather
  "抓取", // scrape/fetch
  "提取", // extract
  "导入", // import
  "导出", // export
  "查找", // find/look up
  "搜索", // search
  "获取", // fetch/get
  "发送", // send
  "发布", // publish/post
  "部署", // deploy
  "保存", // duplicate guard is harmless
] as const;

/**
 * CJK definition stems — "什么是部署？" (what is a deployment?) is a
 * definition that a sufficient answer ends naturally. A CJK fresh-state
 * question ("最新的部署状态是什么？") must NOT match: it ends with the
 * stem but asks for a current state, so the fresh-state signal check wins
 * (T18, AC-19).
 */
const CJK_DEFINITION_STARTERS = ["什么是", "什么是", "什么意思", "为什么", "解释"] as const;

/**
 * Latin-script non-English imperative leads (Spanish/French/German — three
 * of the six supported UI languages). Whole leading words, same shape as
 * ACTION_VERBS: "<verb> <rest>" at the imperative position. This is not
 * translation of the app UI — it is request-intent detection for the
 * languages users actually type (T18, FR-17/18).
 */
const LATIN_ACTION_VERBS = {
  es: ["guarda", "guardar", "busca", "buscar", "envía", "enviar", "recoge", "recopila", "extrae", "exporta", "importa"],
  fr: ["enregistre", "enregistrer", "cherche", "chercher", "envoie", "envoyer", "recueille", "recueillir", "récupère", "exporte", "importe"],
  de: ["speichere", "speichern", "suche", "suchen", "sende", "senden", "exportiere", "exportieren", "importiere", "importieren", "sammle", "sammeln"],
} as const;

export class TaskRequestResolver {
  classify(input: ResolveInput): TaskExecutionRoute {
    // Preparation takes precedence when a plan/approval/permission wait is
    // active (FR-21). A draft plan does not satisfy execution criteria.
    if (input.pendingPlanApproval || input.pendingPermission) {
      return "preparation";
    }

    const message = input.userMessage.trim();

    // An approved task template gives us a verified contract foundation.
    // The objective still comes from the user message; the template cannot
    // broaden authorization (FR-18).
    if (input.hasApprovedTaskTemplate) {
      return "task_verified";
    }

    // A definition question is response_only even if it contains an action
    // verb ("what is send?"). Checked before action-verb detection so a
    // definition stem wins over a verb match. T18a: a fresh-STATE question
    // ("what is the latest deployment status?") must NOT be captured by the
    // definition stem — the fresh-state signal check wins so the
    // retrieval/report task enrolls (AC-19).
    if (
      this.looksLikeDefinitionQuestion(message) &&
      !this.looksLikeFreshStateQuestion(message)
    ) {
      return "response_only";
    }

    if (this.looksLikeFreshInformationTask(message)) {
      return "task_best_effort";
    }

    if (this.looksLikeFreshStateQuestion(message)) {
      return "task_best_effort";
    }

    if (this.looksLikeDeliverableRequest(message)) {
      return "task_best_effort";
    }

    const actionMatch = this.detectActionVerb(message);
    if (actionMatch) {
      // Ambiguous material target → preparation (needs clarification),
      // never an invented verified target (AC-21). Clear target → best_effort.
      if (this.looksLikeAmbiguousAction(message, actionMatch)) {
        return "preparation";
      }
      return "task_best_effort";
    }

    // T18b: a CJK polite imperative ("...連絡先を保存してください" — SOV
    // verb-final with a polite suffix) is an actionable task even though no
    // leading stem matched. Never task_verified without a template (FR-17).
    if (this.looksLikeCjkPoliteImperative(message)) {
      return "task_best_effort";
    }

    // Default conservative: an ordinary conversational response.
    return "response_only";
  }

  /**
   * Strip leading politeness/preamble so verb detection sees the imperative.
   * "Please check the deployment status" → "check the deployment status".
   */
  private stripPolitePrefix(lower: string): string {
    let stripped = lower.trimStart();
    // Strip one prefix; a second polite word is rare and would itself be
    // ambiguous. Loop guards against "please kindly check ...".
    for (let i = 0; i < 2; i++) {
      const prefix = POLITE_PREFIXES.find((p) => stripped.startsWith(p));
      if (!prefix) break;
      stripped = stripped.slice(prefix.length).trimStart();
    }
    return stripped;
  }

  /**
   * Detect an imperative action verb at the start of the message (after
   * polite-prefix stripping). Returns the matched verb or null. Whole-word
   * match at the imperative position — NOT a substring scan — so "send" in
   * the middle of a definition question does not trigger (FR-18). T18:
   * extended to CJK leading stems ("保存100个联系人" starts with the 保存
   * stem; CJK has no word spaces so the stem IS the imperative lead) and
   * Latin-script non-English imperatives (guarda/enregistre/speichere).
   */
  private detectActionVerb(message: string): string | null {
    const lower = this.stripPolitePrefix(message.toLowerCase());
    for (const verb of ACTION_VERBS) {
      // Match the verb followed by a word boundary (space, punctuation, or
      // end-of-string) so "save" doesn't match "saving" or "saved".
      if (lower === verb || lower.startsWith(verb + " ") || lower.startsWith(verb + ",") || lower.startsWith(verb + ".")) {
        return verb;
      }
    }
    // CJK leading stems: no word spaces, so the stem prefix IS the
    // imperative lead. Matched on the polite-prefix-stripped original (CJK
    // is unaffected by lowercasing).
    const cjkStripped = this.stripCjkPolitePrefix(message);
    for (const verb of CJK_ACTION_VERBS) {
      if (cjkStripped.startsWith(verb)) {
        return verb;
      }
    }
    // Latin-script non-English imperatives (es/fr/de).
    const latinMatch = this.detectLatinActionVerb(lower);
    if (latinMatch) {
      return latinMatch;
    }
    return null;
  }

  /**
   * Detect a Spanish/French/German imperative lead at the start of the
   * message. Whole-word boundary like ACTION_VERBS (verb + space/punct/end).
   */
  private detectLatinActionVerb(lower: string): string | null {
    for (const verbs of Object.values(LATIN_ACTION_VERBS)) {
      for (const verb of verbs) {
        if (
          lower === verb ||
          lower.startsWith(verb + " ") ||
          lower.startsWith(verb + ",") ||
          lower.startsWith(verb + ".")
        ) {
          return verb;
        }
      }
    }
    return null;
  }

  /**
   * "What is a deployment?" — a definition/explanation request that a
   * sufficient answer ends naturally. No retrieval/report required. CJK
   * equivalent: "什么是部署？" (T18). Note: a fresh-STATE question that opens
   * with the same stem must NOT match — `classify` additionally requires
   * `!looksLikeFreshStateQuestion` before trusting this result (AC-19).
   */
  private looksLikeDefinitionQuestion(message: string): boolean {
    const lower = this.stripPolitePrefix(message.toLowerCase());
    // The message must be a question (contains "?" or the CJK "？") AND
    // start with a definition stem. A "check the latest status" request does
    // not match.
    const isQuestion = message.includes("?") || message.includes("？");
    if (!isQuestion) return false;
    return (
      DEFINITION_STARTERS.some(
        (s) => lower.startsWith(s + " ") || lower === s
      ) || this.startsWithCjkStem(message, CJK_DEFINITION_STARTERS)
    );
  }

  /**
   * "What is the latest deployment status?" — a fresh-state question that
   * opens with a definition stem but asks for a CURRENT/external state
   * (T18a, FR-17/18, AC-19). Retrieval/report is the task. CJK equivalent:
   * "最新的部署状态是什么？" — ends with the stem but carries a
   * status/最新/当前 signal.
   */
  private looksLikeFreshStateQuestion(message: string): boolean {
    const lower = this.stripPolitePrefix(message.toLowerCase());
    const isQuestion = message.includes("?") || message.includes("？");
    if (!isQuestion) return false;
    return (
      FRESH_STATE_SIGNALS.some((s) => lower.includes(s)) ||
      this.containsCjkSignal(message)
    );
  }

  /**
   * CJK fresh-state signals inside a question: 状态/最新/当前/进度/现在/更新.
   * Mirrors FRESH_STATE_SIGNALS for the CJK question forms users type.
   */
  private containsCjkSignal(message: string): boolean {
    const cjkSignals = [
      "状态", // status
      "最新", // latest
      "当前", // current
      "进度", // progress
      "现在", // now
      "更新", // update
    ] as const;
    return cjkSignals.some((s) => message.includes(s));
  }

  /**
   * True when the message starts with one of the given CJK stems (after
   * polite-prefix stripping). CJK has no spaces, so the match is a prefix
   * test on the stem itself — not a substring scan of the whole message
   * (FR-18).
   */
  private startsWithCjkStem(message: string, stems: readonly string[]): boolean {
    const stripped = this.stripCjkPolitePrefix(message);
    return stems.some((s) => stripped.startsWith(s));
  }

  /**
   * Strip CJK polite prefixes ("请保存..." → "保存..."). Mirrors
   * stripPolitePrefix for CJK forms.
   */
  private stripCjkPolitePrefix(message: string): string {
    let stripped = message.trimStart();
    for (let i = 0; i < 2; i++) {
      const prefix = CJK_POLITE_PREFIXES.find((p) => stripped.startsWith(p));
      if (!prefix) break;
      stripped = stripped.slice(prefix.length).trimStart();
    }
    return stripped;
  }

  /**
   * "Check the latest deployment status" — retrieval/report is the task
   * even though it resembles a question (FR-18, AC-19). Detected by
   * imperative action verbs targeting a current/external state.
   */
  private looksLikeFreshInformationTask(message: string): boolean {
    const lower = this.stripPolitePrefix(message.toLowerCase());
    return RETRIEVAL_VERBS.some(
      (s) => lower.startsWith(s + " ") || lower === s
    );
  }

  /**
   * "Write a blog post and a tweet" — a text/artifact deliverable. Actual
   * valid text can pass without tools (AC-20); every requested part must
   * pass. T18b: "create" + a bare noun phrase without an article ("Create
   * three launch tweets", "Create the weekly report") also matches — the
   * "create a"/"create an" entries alone silently bypassed enrollment.
   */
  private looksLikeDeliverableRequest(message: string): boolean {
    const lower = this.stripPolitePrefix(message.toLowerCase());
    if (
      DELIVERABLE_VERBS.some(
        (s) => lower.startsWith(s + " ") || lower === s
      )
    ) {
      return true;
    }
    // "create" + noun phrase (no article): "create three launch tweets".
    // Whole-word "create" + space, then any non-empty rest.
    return (
      lower.startsWith("create ") && lower.slice("create ".length).trim().length > 0
    );
  }

  /**
   * "Send the thing." — material target/action present but ambiguous.
   * Returns preparation (needs clarification), never an invented target.
   *
   * An action verb with no clear recipient/target/quantity is ambiguous.
   * We look for a target signal: a recipient phrase ("to <X>"), a quantity
   * ("<N> <things>"), or enough words to imply a described target. Without
   * one, the request needs clarification (AC-21).
   */
  private looksLikeAmbiguousAction(message: string, _verb: string): boolean {
    const lower = message.toLowerCase();
    // A recipient phrase "to <someone>" or "into <place>" indicates a target.
    if (/\b(?:to|into|onto|at|for)\s+\S/.test(lower)) {
      return false;
    }
    // A quantity ("<N> <things>") indicates a concrete target.
    if (/\b\d+\s+\S/.test(lower)) {
      return false;
    }
    // T18b: CJK quantity markers ("<N>个/件/名/条/位") are concrete-target
    // signals. CJK has no word spaces, so the "\d+\s+\S" check above never
    // fires for "保存100个联系人" — the quantity and noun are unspaced.
    if (this.hasCjkQuantityMarker(message)) {
      return false;
    }
    // Enough words to describe a target (heuristic threshold). Short
    // imperatives like "send it" or "post this" are ambiguous. CJK
    // text has no spaces (a whole sentence splits to one "word"), so this
    // threshold only applies to spaced scripts; CJK ambiguity is decided by
    // the quantity/recipient checks above.
    if (/[一-鿿぀-ヿ]/.test(message)) {
      return false;
    }
    return message.split(/\s+/).length <= 4;
  }

  /**
   * True when the message carries a CJK quantity marker — a number
   * immediately followed by a CJK measure word (个/件/名/条/只/位/家/封).
   * "保存100个联系人" / "发送5封邮件" both carry one.
   */
  private hasCjkQuantityMarker(message: string): boolean {
    return /\d+(?:个|件|名|条|只|位|家|封)/.test(message);
  }

  /**
   * True when the message is a CJK polite imperative — a CJK action verb
   * anywhere in the message PLUS a polite request suffix/marker
   * ("てください" / "ください" / "をお願いします" / "请"). Japanese SOV order
   * puts the verb at the END ("...連絡先を保存してください"), so leading-stem
   * detection never fires; the polite suffix is what marks the request as an
   * imperative rather than a statement (T18, FR-17).
   */
  private looksLikeCjkPoliteImperative(message: string): boolean {
    const politeSuffixes = [
      "てください",
      "ください",
      "をお願いします",
      "お願いします",
      "お願い致します",
    ] as const;
    const hasPoliteSuffix = politeSuffixes.some((s) => message.includes(s));
    const hasPolitePrefix = CJK_POLITE_PREFIXES.some((p) =>
      message.startsWith(p)
    );
    if (!hasPoliteSuffix && !hasPolitePrefix) {
      return false;
    }
    return CJK_ACTION_VERBS.some((v) => message.includes(v));
  }
}
