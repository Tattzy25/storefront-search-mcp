import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
const searchCatalogInputSchema = z.object({
  shop_domain: z
    .string()
    .describe("The shop domain to call. This maps to https://{shop-domain}/api/ucp/mcp."),
  meta: z
    .object({
      "ucp-agent": z.object({
        profile: z
          .string()
          .url()
          .describe("The URI to your agent's UCP profile for capability negotiation.")
      })
    })
    .describe("Request metadata. You must include ucp-agent.profile."),
  catalog: z
    .object({
      query: z
        .string()
        .describe("Free-text search query. For example, \"organic coffee beans\", \"winter jacket\".")
        .optional(),
      context: z
        .object({
          address_country: z.string().optional().describe("Localization hint for the buyer country."),
          language: z.string().optional().describe("Localization hint for the buyer language."),
          currency: z.string().optional().describe("Localization hint for the buyer currency."),
          intent: z.string().optional().describe("The buyer's intent or shopping context.")
        })
        .describe("Buyer signals for relevance and localization (address_country, language, currency, and intent).")
        .optional(),
      filters: z
        .object({
          available: z
            .boolean()
            .describe("Filter by availability. Defaults to true (only sale-ready items). Set to false to include unavailable items.")
        })
        .describe("Availability filter. When true (default), only sale-ready items are returned. Set to false to include unavailable items.")
        .optional(),
      pagination: z
        .object({
          cursor: z
            .string()
            .describe("Opaque cursor from a previous response. Pass the returned pagination.cursor as catalog.pagination.cursor to request the next page.")
            .optional(),
          limit: z
            .number()
            .int()
            .min(1)
            .max(250)
            .describe("Page size. Integer, min 1, default 10, max 250.")
            .optional()
        })
        .describe("Cursor-based pagination controls. The cursor carries only the next result offset, so the request's limit controls page size.")
        .optional()
    })
    .describe("The catalog object containing the search parameters. All parameters are wrapped in a catalog object. Refer to the UCP catalog search spec for the complete schema.")
});
const lookupCatalogInputSchema = z.object({
  shop_domain: z
    .string()
    .describe("The shop domain to call. This maps to https://{shop-domain}/api/ucp/mcp."),
  meta: z
    .object({
      "ucp-agent": z.object({
        profile: z
          .string()
          .url()
          .describe("The URI to your agent's UCP profile for capability negotiation.")
      })
    })
    .describe("Request metadata. You must include ucp-agent.profile."),
  catalog: z
    .object({
      ids: z
        .array(z.string())
        .min(1)
        .max(10)
        .describe("Array of product or variant identifiers (up to 10). For example, \"gid://shopify/Product/123\"."),
      context: z
        .object({
          address_country: z.string().optional().describe("Localization hint for the buyer country."),
          language: z.string().optional().describe("Localization hint for the buyer language."),
          currency: z.string().optional().describe("Localization hint for the buyer currency."),
          intent: z.string().optional().describe("The buyer's intent or shopping context.")
        })
        .describe("Buyer context for localization (address_country, language, currency, and intent).")
        .optional()
    })
    .describe("The catalog object containing the lookup parameters. All parameters are wrapped in a catalog object. Refer to the UCP catalog lookup spec for the complete schema.")
});
const getProductInputSchema = z.object({
  shop_domain: z
    .string()
    .describe("The shop domain to call. This maps to https://{shop-domain}/api/ucp/mcp."),
  meta: z
    .object({
      "ucp-agent": z.object({
        profile: z
          .string()
          .url()
          .describe("The URI to your agent's UCP profile for capability negotiation.")
      })
    })
    .describe("Request metadata. You must include ucp-agent.profile."),
  catalog: z
    .object({
      id: z
        .string()
        .describe("Product or variant identifier. For example, \"gid://shopify/Product/123\"."),
      selected: z
        .array(
          z.object({
            name: z.string().describe("The option name, e.g. \"Color\" or \"Size\"."),
            label: z.string().describe("The option value label, e.g. \"Blue\" or \"10\".")
          })
        )
        .describe("Option selections for variant narrowing. For example, [{\"name\": \"Color\", \"label\": \"Blue\"}]. The response reflects these selections in product.selected and filters the returned variants accordingly.")
        .optional(),
      context: z
        .object({
          address_country: z.string().optional().describe("Localization hint for the buyer country."),
          language: z.string().optional().describe("Localization hint for the buyer language."),
          currency: z.string().optional().describe("Localization hint for the buyer currency."),
          intent: z.string().optional().describe("The buyer's intent or shopping context.")
        })
        .describe("Buyer context for localization (address_country, language, currency, and intent).")
        .optional()
    })
    .describe("The catalog object containing the product lookup parameters. All parameters are wrapped in a catalog object. Refer to the UCP catalog lookup spec for the complete schema.")
});
function formatCatalogMarkdown(result: Record<string, unknown>): string {
  const data = (result.result as Record<string, unknown>) ?? result;
  const catalog = (data.catalog as Record<string, unknown>) ?? data;
  const products = (catalog.products as Array<Record<string, unknown>>) ?? [];
  const fmtPrice = (p: Record<string, unknown> | undefined) => {
    if (!p) return "—";
    const amount = p.amount as number | undefined;
    if (amount === undefined) return "—";
    const major = (amount / 100).toFixed(2);
    const currency = (p.currency as string) ?? "";
    return currency ? `${major} ${currency}` : `$${major}`;
  };
  const fmtProduct = (p: Record<string, unknown>) => {
    const title = (p.title as string) ?? "Untitled";
    const url = (p.url as string) ?? "";
    const description = (p.description as string) ?? "";
    const oneLine = description.split("\n")[0].trim();
    const priceRange = p.price_range as Record<string, unknown> | undefined;
    const price = p.price as Record<string, unknown> | undefined;
    let priceStr = "—";
    if (priceRange) {
      const min = priceRange.min as Record<string, unknown> | undefined;
      const max = priceRange.max as Record<string, unknown> | undefined;
      if (min && max && min.amount !== max.amount)
        priceStr = `${fmtPrice(min)} – ${fmtPrice(max)}`;
      else
        priceStr = fmtPrice(min ?? max);
    } else {
      priceStr = fmtPrice(price);
    }
    const media = (p.media as Array<Record<string, unknown>>) ?? [];
    const img = media[0];
    const imgSrc = (img?.url as string) ?? (img?.src as string) ?? "";
    const imgAlt = (img?.alt as string) ?? title;
    const link = url ? `[${title}](${url})` : title;
    const imageMd = imgSrc ? `![${imgAlt}](${imgSrc})` : "";
    return `### ${link}\n${imageMd}\n**${priceStr}**\n${oneLine}`;
  };
  return products.map(fmtProduct).join("\n\n---\n\n");
}
function createServer() {
  const server = new McpServer({
    name: "Storefront Search MCP",
    version: "1.0.0"
  });
  server.registerTool(
    "search_catalog",
    {
      description: "Searches the store's product catalog. The response conforms to the UCP catalog search response, including a UCP metadata envelope; products with title, description, price range (minor units), media, and variants; and cursor-based pagination. When to use: A customer asks \"Do you have any organic coffee?\", You need to find products matching specific criteria, or A customer wants to browse items in a category.",
      inputSchema: searchCatalogInputSchema
    },
    async ({ shop_domain, meta, catalog }: z.infer<typeof searchCatalogInputSchema>) => {
      const response = await fetch(`https://${shop_domain}/api/ucp/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          id: 2,
          params: { name: "search_catalog", arguments: { meta, catalog } }
        })
      });
      const result = await response.json() as Record<string, unknown>;
      return { content: [{ text: formatCatalogMarkdown(result), type: "text" }], structuredContent: result };
    }
  );
  server.registerTool(
    "lookup_catalog",
    {
      description: "Retrieves products or variants by identifier. The response conforms to the UCP catalog lookup response, including products with inputs correlation on each variant and not_found messages for unresolved identifiers. Use this when you have product or variant IDs from search results or deep links, need to resolve multiple identifiers in a single request, or are validating cart items against current catalog data.",
      inputSchema: lookupCatalogInputSchema
    },
    async ({ shop_domain, meta, catalog }: z.infer<typeof lookupCatalogInputSchema>) => {
      const response = await fetch(`https://${shop_domain}/api/ucp/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          id: 3,
          params: { name: "lookup_catalog", arguments: { meta, catalog } }
        })
      });
      const result = await response.json() as Record<string, unknown>;
      return { content: [{ text: formatCatalogMarkdown(result), type: "text" }], structuredContent: result };
    }
  );
  server.registerTool(
    "get_product",
    {
      description: "Retrieves full details for a single product with optional variant selection. The response conforms to the UCP catalog get_product response, including product.selected reflecting effective option selections, option values with available and exists signals, and variants matching the selection. Use this when a customer has selected a product and needs full details, you need to show variant options with availability signals, or a customer is making option selections (Color, Size, and so on).",
      inputSchema: getProductInputSchema
    },
    async ({ shop_domain, meta, catalog }: z.infer<typeof getProductInputSchema>) => {
      const response = await fetch(`https://${shop_domain}/api/ucp/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          id: 4,
          params: { name: "get_product", arguments: { meta, catalog } }
        })
      });
      const result = await response.json() as Record<string, unknown>;
      return { content: [{ text: formatCatalogMarkdown(result), type: "text" }], structuredContent: result };
    }
  );
  return server;
}
export default {
  fetch(request, env, ctx) {
    return createMcpHandler(() => createServer(env, request), { allowedOriginHostnames: "*" })(request, env, ctx);
  }
} satisfies ExportedHandler;
