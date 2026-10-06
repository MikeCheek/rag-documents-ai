import { describe, expect, it } from "vitest";
import { importSpec, parseSpecText, toolNameFor } from "@/lib/agent/openapi";

const petstore = {
  openapi: "3.0.0",
  info: { title: "Petstore" },
  servers: [{ url: "https://api.example.com/v1" }],
  components: {
    securitySchemes: { key: { type: "apiKey", in: "header", name: "X-API-Key" } },
    parameters: { Limit: { name: "limit", in: "query", schema: { type: "integer" }, description: "Max items" } },
    schemas: {
      NewPet: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Pet name" },
          species: { type: "string", enum: ["cat", "dog"] },
          id: { type: "integer", readOnly: true },
        },
      },
    },
  },
  paths: {
    "/pets": {
      get: { operationId: "listPets", summary: "List pets", parameters: [{ $ref: "#/components/parameters/Limit" }] },
      post: {
        operationId: "createPet",
        summary: "Create a pet",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NewPet" } } } },
      },
    },
    "/pets/{petId}": {
      parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
      get: { operationId: "getPet", summary: "Get a pet" },
      delete: { summary: "Delete a pet" },
    },
    "/pets/{petId}/photo": {
      put: { operationId: "uploadPhoto", requestBody: { content: { "image/png": {} } } },
    },
  },
};

describe("importSpec", () => {
  const spec = importSpec(petstore);

  it("reads title, base URL and auth", () => {
    expect(spec.title).toBe("Petstore");
    expect(spec.baseUrl).toBe("https://api.example.com/v1");
    expect(spec.auth).toMatchObject({ type: "header", name: "X-API-Key" });
  });

  it("turns query parameters into URL placeholders, resolving $refs", () => {
    const op = spec.operations.find((o) => o.name === "listPets")!;
    expect(op).toMatchObject({ method: "GET", urlTemplate: "/pets?limit={limit}" });
    expect(op.parameters).toEqual([{ name: "limit", type: "integer", description: "Max items", required: false }]);
  });

  it("turns JSON body fields into parameters, skipping read-only ones", () => {
    const op = spec.operations.find((o) => o.name === "createPet")!;
    expect(op.urlTemplate).toBe("/pets");
    expect(op.parameters).toEqual([
      { name: "name", type: "string", description: "Pet name", required: true },
      { name: "species", type: "string", description: "request body field", required: false, enum: ["cat", "dog"] },
    ]);
  });

  it("inherits path-level parameters and names operations without an operationId", () => {
    const get = spec.operations.find((o) => o.name === "getPet")!;
    expect(get.parameters[0]).toMatchObject({ name: "petId", required: true });
    const del = spec.operations.find((o) => o.method === "DELETE")!;
    expect(del.name).toBe("delete_pets_petId");
    expect(del.urlTemplate).toBe("/pets/{petId}");
  });

  it("flags operations it can't send", () => {
    expect(spec.operations.find((o) => o.name === "uploadPhoto")!.unsupported).toMatch(/isn't JSON/);
  });

  it("reads Swagger 2.0 too", () => {
    const s = importSpec({
      swagger: "2.0",
      info: { title: "Old" },
      host: "old.example.com",
      basePath: "/api",
      schemes: ["https"],
      securityDefinitions: { token: { type: "apiKey", in: "query", name: "token" } },
      paths: {
        "/items": {
          post: {
            operationId: "addItem",
            parameters: [{ in: "body", name: "body", schema: { type: "object", properties: { title: { type: "string" } } } }],
          },
        },
      },
    });
    expect(s.baseUrl).toBe("https://old.example.com/api");
    expect(s.auth).toMatchObject({ type: "query", name: "token" });
    expect(s.operations[0].parameters.map((p) => p.name)).toEqual(["title"]);
  });

  it("rejects things that aren't API specs", () => {
    expect(() => importSpec({ hello: "world" })).toThrow(/OpenAPI/);
  });
});

describe("helpers", () => {
  it("parses YAML and JSON", async () => {
    expect(await parseSpecText("openapi: 3.0.0\npaths: {}\n")).toEqual({ openapi: "3.0.0", paths: {} });
    expect(await parseSpecText('{"swagger":"2.0"}')).toEqual({ swagger: "2.0" });
  });

  it("makes function-safe names", () => {
    expect(toolNameFor("get-user.by id", "GET", "/x")).toBe("get_user_by_id");
    expect(toolNameFor(undefined, "GET", "/users/{id}")).toBe("get_users_id");
    expect(toolNameFor("1st", "GET", "/x")).toBe("op_1st");
  });
});
