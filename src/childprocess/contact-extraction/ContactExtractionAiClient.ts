import type {
  ContactExtractionRequest,
  ContactExtractionResponse,
} from "@/api/aiChatApi";

type ApiResponse = {
  status?: boolean;
  msg?: string;
  data?: ContactExtractionResponse;
};

function getApiBaseUrl(): string {
  const configured = process.env.VITE_LOGIN_URL?.trim();
  return `${configured && configured.length > 0 ? configured : "http://localhost:3000"}/apis`;
}

export async function extractContactInfoWithWorkerAi(
  request: ContactExtractionRequest
): Promise<ApiResponse> {
  if (process.env.WORKER_AI_ENABLED !== "true") {
    throw new Error("AI features are not enabled.");
  }

  const token = process.env.WORKER_AUTH_TOKEN?.trim();
  const response = await fetch(`${getApiBaseUrl()}/api/ai/contact/extract`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`AI extraction request failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as ApiResponse;
}
