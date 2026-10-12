/** اختبارات لوحة التحكم: هروب JSX، توقيع الجلسات، ترجمة الأخطاء. */
import { describe, expect, test } from "bun:test";
import { escapeHtml, Fragment, jsx, raw, render } from "../dashboard/jsx/jsx-runtime.ts";
import { parseCookies, safeEqual, serializeCookie, signSession, verifySession } from "../dashboard/lib/session.ts";

describe("jsx runtime", () => {
  test("escapes text children and attributes by default", () => {
    const evil = `<script>alert("x")</script>&'`;
    const html = String(jsx("div", { title: evil, "data-x": evil, children: evil }));
    expect(html).not.toContain("<script>");
    expect(html).toBe(
      `<div title="&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;" data-x="&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;">` +
        `&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;</div>`,
    );
  });

  test("raw() is not escaped, nested elements are not double-escaped", () => {
    const icon = raw(`<svg class="i"><use href="#i-x"/></svg>`);
    expect(String(jsx("b", { children: [icon, jsx("i", { children: "a&b" })] }))).toBe(`<b><svg class="i"><use href="#i-x"/></svg><i>a&amp;b</i></b>`);
  });

  test("boolean / null attributes, void elements, arrays, fragments, components", () => {
    const Item = ({ n }: { n: number }) => jsx("li", { "data-n": n, children: n });
    const html = String(
      jsx(Fragment, {
        children: [
          jsx("input", { disabled: true, checked: false, value: "", placeholder: undefined }),
          jsx("ul", { children: [1, 2].map((n) => jsx(Item, { n })) }),
          false, null, 0,
        ],
      }),
    );
    expect(html).toBe(`<input disabled value=""><ul><li data-n="1">1</li><li data-n="2">2</li></ul>0`);
  });

  test("rejects unsafe attribute names and className maps to class", () => {
    const props: Record<string, unknown> = { className: "a", 'x" onclick="alert(1)': "y" };
    expect(String(jsx("p", props))).toBe(`<p class="a"></p>`);
  });

  test("helpers", () => {
    expect(escapeHtml(`"<>&'`)).toBe("&quot;&lt;&gt;&amp;&#39;");
    expect(render(["a", raw("<b>"), 1n]).value).toBe("a<b>1");
    expect(String(Fragment({ children: ["<", ">"] }))).toBe("&lt;&gt;");
  });
});

describe("session signing", () => {
  const secret = "test-secret";
  const data = { user: { id: "123456789012345678901", name: "n", global_name: "g", avatar: "a" }, guilds: ["1234567890123456789"], csrf: "c" };

  test("round-trips and keeps snowflake IDs as strings", () => {
    const v = verifySession(signSession(data, secret, 60), secret);
    expect(v?.user?.id).toBe("123456789012345678901");
    expect(v?.guilds).toEqual(["1234567890123456789"]);
    expect(typeof v?.exp).toBe("number");
  });

  test("rejects tampering, wrong secret, garbage and expiry", () => {
    const s = signSession(data, secret, 60);
    const [body, sig] = s.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...data, guilds: ["1", "2"], exp: 9e9 })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, secret)).toBeNull();
    expect(verifySession(`${body}.${sig.slice(0, -1)}A`, secret)).toBeNull();
    expect(verifySession(s, "other")).toBeNull();
    expect(verifySession("nope", secret)).toBeNull();
    expect(verifySession(undefined, secret)).toBeNull();
    expect(verifySession(signSession(data, secret, 60, Date.now() - 120_000), secret)).toBeNull();
  });

  test("cookies", () => {
    expect(parseCookies("a=1; session=x.y; lang=en; a=2")).toEqual({ a: "1", session: "x.y", lang: "en" });
    const c = serializeCookie("session", "v", { maxAge: 10, secure: true });
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});

describe("error translation", async () => {
  const { translateError } = await import("../dashboard/lib/errors.ts");
  test("ar passthrough, en translation, REQ untouched", () => {
    expect(translateError("سجّل دخولك أول", "ar")).toBe("سجّل دخولك أول");
    expect(translateError("سجّل دخولك أول", "en")).toBe("Please sign in first");
    expect(translateError("REQ:name", "en")).toBe("REQ:name");
    expect(translateError("متغير غير معروف: {x}", "en")).toBe("Unknown variable: {x}");
  });
});
