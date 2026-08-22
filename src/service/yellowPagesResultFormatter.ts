import { YellowPagesResult } from "@/modules/interface/ITaskManager";

/**
 * Format YellowPages business results as a readable string for the LLM.
 * Extracted from ai-chat-ipc.ts during v1-chat retirement (R6.2).
 */
export function formatYellowPagesResultsForLLM(
  results: YellowPagesResult[]
): string {
  if (results.length === 0) {
    return "No business results found.";
  }

  const formattedResults = results
    .map((result, index) => {
      const businessName = result.business_name || "Unknown Business";
      const phone = result.phone ? `Phone: ${result.phone}` : "";
      const email = result.email ? `Email: ${result.email}` : "";
      const website = result.website ? `Website: ${result.website}` : "";

      const addressParts: string[] = [];
      if (result.address?.street) addressParts.push(result.address.street);
      if (result.address?.city) addressParts.push(result.address.city);
      if (result.address?.state) addressParts.push(result.address.state);
      if (result.address?.zip) addressParts.push(result.address.zip);
      const address =
        addressParts.length > 0 ? `Address: ${addressParts.join(", ")}` : "";

      const categories =
        result.categories &&
        Array.isArray(result.categories) &&
        result.categories.length > 0
          ? `Categories: ${result.categories.join(", ")}`
          : "";

      const rating = result.rating ? `Rating: ${result.rating}/5` : "";
      const reviewCount = result.review_count
        ? `(${result.review_count} reviews)`
        : "";
      const ratingInfo = rating ? `${rating} ${reviewCount}`.trim() : "";

      const contactInfo = [phone, email, website].filter(Boolean).join(" | ");

      const parts = [
        `${index + 1}. **${businessName}**`,
        contactInfo && `   ${contactInfo}`,
        address && `   ${address}`,
        categories && `   ${categories}`,
        ratingInfo && `   ${ratingInfo}`,
      ].filter(Boolean);

      return parts.join("\n");
    })
    .join("\n\n");

  return `Found ${results.length} business result${
    results.length === 1 ? "" : "s"
  }:\n\n${formattedResults}`;
}
