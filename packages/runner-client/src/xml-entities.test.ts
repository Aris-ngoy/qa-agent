import { describe, expect, test } from "bun:test";
import { decodeXmlEntities } from "./xml-entities";

describe("decodeXmlEntities", () => {
	test("decodes named XML entities", () => {
		expect(decodeXmlEntities("Help &amp; Info")).toBe("Help & Info");
		expect(decodeXmlEntities("&lt;tag&gt;")).toBe("<tag>");
		expect(decodeXmlEntities("&quot;hi&quot; &apos;there&apos;")).toBe(`"hi" 'there'`);
	});

	test("does not cascade — &amp;lt; stays &lt;", () => {
		expect(decodeXmlEntities("&amp;lt;")).toBe("&lt;");
	});

	test("decodes decimal and hex numeric entities", () => {
		expect(decodeXmlEntities("Help &#38; Info")).toBe("Help & Info");
		expect(decodeXmlEntities("Help &#x26; Info")).toBe("Help & Info");
	});

	test("leaves unknown named entities intact", () => {
		expect(decodeXmlEntities("a&nbsp;b")).toBe("a&nbsp;b");
	});
});
