import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const searchCatalogInputSchema = z.object({
  shop_domain: z.string().describe("The shop domain to call. This maps to https://{shop-domain}/api/ucp/mcp."),
  meta: z.object({
    "ucp-agent": z.object({
      profile: z.string().url().describe("The URI to your agent's UCP profile for capability negotiation.")
    })
  }).describe("Request metadata. You must include ucp-agent.profile."),
  catalog: z.object({
    query: z.string().optional().describe("Free-text search query. For example, \"organic coffee beans\", \"winter jacket\"."),
    context: z.object({
      address_country: z.string().optional(),
      language: z.string().optional(),
      currency: z.string().optional(),
      intent: z.string().optional()
    }).optional(),
    filters: z.object({
      available: z.boolean().describe("Filter by availability. Defaults to true.")
    }).optional(),
    pagination: z.object({
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(250).optional()
    }).optional()
  }).describe("The catalog object containing the search parameters.")
});

const lookupCatalogInputSchema = z.object({
  shop_domain: z.string(),
  meta: z.object({
    "ucp-agent": z.object({ profile: z.string().url() })
  }),
  catalog: z.object({
    ids: z.array(z.string()).min(1).max(10).describe("Array of product or variant identifiers (up to 10)."),
    context: z.object({
      address_country: z.string().optional(),
      language: z.string().optional(),
      currency: z.string().optional(),
      intent: z.string().optional()
    }).optional()
  })
});

const getProductInputSchema = z.object({
  shop_domain: z.string(),
  meta: z.object({
    "ucp-agent": z.object({ profile: z.string().url() })
  }),
  catalog: z.object({
    id: z.string().describe("Product or variant identifier."),
    selected: z.array(
      z.object({ name: z.string(), label: z.string() })
    ).optional(),
    context: z.object({
      address_country: z.string().optional(),
      language: z.string().optional(),
      currency: z.string().optional(),
      intent: z.string().optional()
    }).optional()
  })
});

function formatProduct(p: any): string {
  if (!p) return "";
  
  const productUrl = p.url || '';
  const productTitle = p.title || p.id || "Untitled Product";
  
  let md = `### [${productTitle}](${productUrl})\n\n`;
  
  if (p.media && Array.isArray(p.media) && p.media.length > 0 && p.media[0].url) {
    const imageUrl = p.media[0].url;
    md += `[![${productTitle}](${imageUrl})](${productUrl})\n\n`;
  }
  
  if (p.price_range?.min) {
    const minPrice = (p.price_range.min.amount / 100).toFixed(2);
    const currency = p.price_range.min.currency;
    md += `**Price:** ${minPrice}${currency}\n\n`;
  }
  
  if (p.description?.html) {
    const cleanDesc = p.description.html.replace(/<[^>]*>?/gm, '').trim();
    const words = cleanDesc.split(/\s+/);
    const shortDesc = words.slice(0, 6).join(" ");
    md += `${shortDesc}${words.length > 6 ? '...' : ''}\n\n`;
  }

  if (p.options && Array.isArray(p.options) && p.options.length > 0) {
    md += `**Options:**\n`;
    p.options.forEach((opt: any) => {
      const values = opt.values?.map((v: any) => v.label || v.name).join(", ");
      if (opt.name && values) md += `- ${opt.name}:${values}\n`;
    });
    md += `\n`;
  }

  if (p.variants && Array.isArray(p.variants) && p.variants.length > 0) {
    md += `**Variants:**\n`;
    p.variants.forEach((v: any) => {
      const vTitle = v.title || v.id || "Default";
      const vPrice = v.price ? `${(v.price.amount / 100).toFixed(2)}${v.price.currency}` : '';
      const status = v.availability?.available ? "✅ In Stock" : "❌ Out of Stock";
      md += `- [${vTitle}](${v.checkout_url || ''}) - ${vPrice}${status}\n`;
    });
    md += `\n`;
  }
  
  return md;
}

function formatToMarkdown(data: any): string {
  try {
    let payload = data;
    if (payload?.result) payload = payload.result;
    if (payload?.structuredContent) payload = payload.structuredContent;

    let md = "";

    const products = payload?.products || payload?.catalog?.products;
    if (products && Array.isArray(products) && products.length > 0) {
      md += `## Catalog Results (${products.length})\n\n`;
      for (const p of products) {
        md += formatProduct(p);
        md += `---\n\n`;
      }
      if (payload?.pagination?.has_next_page) {
        md += `*Next page available. Pass cursor: \`${payload.pagination.cursor}\`*\n`;
      }
      return md.trim();
    }

    const product = payload?.product || payload?.catalog?.product;
    if (product) {
      return formatProduct(product).trim();
    }

    if (payload?.messages && Array.isArray(payload.messages) && payload.messages.length > 0) {
      return `## Storefront Notice\n\n${payload.messages.join("\n")}`;
    }

    return "No products found matching the criteria.";
  } catch (error) {
    return `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  }
}

function createServer() {
  const server = new McpServer({
    name: "Storefront Search MCP",
    version: "1.0.0"
  });

  server.registerTool(
    "search_catalog",
    {
      description: "Searches the store's product catalog. The response conforms to the UCP catalog search response.",
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
      return { content: [{ text: formatToMarkdown(result), type: "text" }], structuredContent: result };
    }
  );

  server.registerTool(
    "lookup_catalog",
    {
      description: "Retrieves products or variants by identifier.",
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
      return { content: [{ text: formatToMarkdown(result), type: "text" }], structuredContent: result };
    }
  );

  server.registerTool(
    "get_product",
    {
      description: "Retrieves full details for a single product with optional variant selection.",
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
      return { content: [{ text: formatToMarkdown(result), type: "text" }] };
    }
  );

  return server;
}

export default {
  fetch(request, env, ctx) {
    return createMcpHandler(() => createServer(env, request), { allowedOriginHostnames: "*" })(request, env, ctx);
  }
} satisfies ExportedHandler;
