import { expect, test } from "bun:test";
import { renderToString, raw } from "#jsx/jsx-runtime";

const Card = (p: { title: string; children?: any }) => <div className="card" data-x={1}><h2>{p.title}</h2>{p.children}</div>;

test("renderToString escapes and renders components", () => {
  expect(renderToString(<Card title={'<b>"x"</b>'}>نص & <br /></Card>)).toBe('<div class="card" data-x="1"><h2>&lt;b&gt;&quot;x&quot;&lt;/b&gt;</h2>نص &amp; <br></div>');
  expect(renderToString(<input disabled value="a" onClick={() => 1} style={{ marginTop: 4 }} />)).toBe('<input disabled value="a" style="margin-top:4">');
  expect(renderToString(<>{raw("<i>ok</i>")}{[1, null, false, "x"]}</>)).toBe("<i>ok</i>1x");
});
