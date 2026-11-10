import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byLabel, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import { normalizeKnowledge } from '../src/studio/knowledge/model.js';

// Build › Knowledge as drawn on the section 10 canvas (FRONTEND_GUIDE 10.2): the "Search index" row (its state, Build
// now, the build followed to the end), each file and page as a card with its state, × asking whether to delete the
// file too (and a 409 explained before forcing), and a search on one score scale. The answers come from a stubbed
// demo API in the server's shapes; nothing reaches a network.
const { mountScreen, act, getDemoApi } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const withDocs = (sources) => {
  const config = applyStarter(minimalConfig('acme', 'Acme'), 'support');
  return { ...config, knowledge: [{ id: 'knowledge', type: 'vector_store', mode: 'inject', retrieval: { min_score: 0.3 }, sources }] };
};
const fileSrc = (name) => ({ type: 'file', file_id: name });
// GET /knowledge as the server says it, for the saved draft
const read = ({ sources, index = null, build = null, problems = [], key = true, files = [] }) =>
  normalizeKnowledge({
    ref: 'draft',
    embedding_key_available: key,
    bases: [{ id: 'knowledge', type: 'vector_store', mode: 'inject', sources, index, build, problems }],
    files,
  });
const mount = (config, extra) =>
  mountScreen('detailed', config, { ready: '.dtPart', props: { part: 'knowledge', extra: { botId: 'x', onUploaded: () => {}, ...extra } } });
const until = async (app, check, tries = 80) => {
  for (let i = 0; i < tries && !check(); i += 1) await app.wait(60);
  return check();
};
// answers the demo never gives, for one test; every call is recorded
async function withAnswers(answer, run) {
  window.localStorage.setItem('weave_demo', '1');
  const demo = getDemoApi();
  const handle = demo.handle;
  const calls = [];
  demo.handle = async (method, path, body) => {
    calls.push(`${method} ${path}`);
    return (await answer(method, path, body, calls)) || handle.call(demo, method, path, body);
  };
  try {
    await run(calls);
  } finally {
    demo.handle = handle;
  }
}
const row = (app, id) => $(app.container, `[data-field="knowledge.${id}"]`);

test('the index row: never built says so and builds on a press, following the build to the end and reading the knowledge again', async () => {
  const sources = [fileSrc('faq.md')];
  let reads = 0;
  await withAnswers(
    (method, path, _body, calls) => {
      if (method === 'POST' && path.endsWith('/knowledge/knowledge/build'))
        return { status: 202, body: { id: 'b1', status: 'running', log: ['Reading the files…'], started_at: new Date().toISOString() } };
      if (method === 'GET' && path.includes('/knowledge/knowledge/status')) {
        const n = calls.filter((c) => c.includes('/status')).length;
        return {
          status: 200,
          body: {
            build:
              n < 2
                ? { id: 'b1', status: 'running', log: ['Reading the files… done', 'Indexing the passages…'], started_at: new Date().toISOString() }
                : { id: 'b1', status: 'done', log: ['Writing the index… done'], result: { passages: 12 } },
          },
        };
      }
      return null;
    },
    async (calls) => {
      const app = await mount(withDocs(sources), {
        knowledgeRead: read({ sources: [{ type: 'file', file_id: 'faq.md', uploaded: true }], files: [{ name: 'faq.md', size: 2048 }] }),
        onUploaded: () => {
          reads += 1;
        },
      });
      const box = $(row(app, 'index'), '.kxIndex');
      assert.equal(box.dataset.state, 'unread');
      assert.match(textOf(box), /Not built yet.*Callers get no answers/);
      await a.click(byText(row(app, 'index'), 'button', 'Build now'));
      assert.ok(await until(app, () => calls.includes('POST /bots/x/knowledge/knowledge/build')), 'built on the press');
      assert.ok(await until(app, () => $(row(app, 'index'), '.kxIndex')?.dataset.state === 'reading'));
      assert.match(textOf(row(app, 'index')), /Building…/);
      assert.ok(await until(app, () => $(row(app, 'index'), '.kxSteps li[aria-current="step"]')?.textContent === 'Embed'), 'the steps follow the log');
      assert.ok(await until(app, () => reads > 0), 'the knowledge is read again when the build ends');
      await app.unmount();
    },
  );
});

test('the index row: a draft that differs from the saved one offers Save and build; no embedding key turns Build off and says why', async () => {
  const unsaved = await mount(withDocs([fileSrc('faq.md'), fileSrc('new.md')]), {
    knowledgeRead: read({ sources: [{ type: 'file', file_id: 'faq.md', uploaded: true }] }),
  });
  assert.equal($(row(unsaved, 'index'), '.kxIndex').dataset.state, 'unsaved');
  assert.ok(byText(row(unsaved, 'index'), 'button', 'Save and build'));
  await unsaved.unmount();

  const noKey = await mount(withDocs([fileSrc('faq.md')]), {
    knowledgeRead: read({ sources: [{ type: 'file', file_id: 'faq.md', uploaded: true }], key: false }),
  });
  assert.equal(byText(row(noKey, 'index'), 'button', 'Build now').disabled, true);
  assert.match(textOf(row(noKey, 'index')), /no embedding key\. An operator has to set it/);
  await noKey.unmount();

  const ready = await mount(withDocs([fileSrc('faq.md')]), {
    knowledgeRead: read({
      sources: [{ type: 'file', file_id: 'faq.md', uploaded: true }],
      index: {
        built_at: '2026-11-05T10:42:00Z',
        passages: 214,
        embedding: { provider: 'openai', model: 'text-embedding-3-small' },
        documents: [{ name: 'faq.md', passages: 214 }],
      },
    }),
  });
  assert.equal($(row(ready, 'index'), '.kxIndex').dataset.state, 'ready');
  assert.match(textOf(row(ready, 'index')), /Up to date.*214 passages.*text-embedding-3-small/);
  assert.ok(byText(row(ready, 'index'), 'button', 'Build again'));
  await ready.unmount();
});

test('the files and pages are cards that each say their state, and a fix when something is wrong', async () => {
  const config = withDocs([
    fileSrc('faq.md'),
    fileSrc('changed.md'),
    fileSrc('warranty.pdf'),
    { type: 'url', url: 'https://help.acme.example', crawl_depth: 2 },
  ]);
  const app = await mount(config, {
    knowledgeRead: read({
      sources: [
        { type: 'file', file_id: 'faq.md', uploaded: true },
        { type: 'file', file_id: 'changed.md', uploaded: true },
        { type: 'file', file_id: 'warranty.pdf', uploaded: false },
        { type: 'url', url: 'https://help.acme.example' },
      ],
      index: {
        built_at: '2026-11-05T10:42:00Z',
        passages: 50,
        documents: [
          { name: 'faq.md', passages: 41 },
          { name: 'changed.md', passages: 9 },
        ],
      },
      problems: [{ problem: 'The file changed.md changed after the index was built.', fix: 'python -m weave.knowledge build' }],
      files: [
        { name: 'faq.md', size: 217088 },
        { name: 'changed.md', size: 8192 },
      ],
    }),
  });
  const card = (key) => $(app.container, `[data-source="${key}"]`);
  assert.match(textOf(card('file:faq.md')), /faq\.md.*212 KB · 41 passages.*In the index/);
  assert.match(textOf(card('file:changed.md')), /Changed since the build.*Fix: Build it again\./, 'an operator’s command line is never shown as the fix');
  assert.match(textOf(card('file:warranty.pdf')), /Not uploaded.*Fix: Upload it, or take it out\./);
  assert.match(textOf(card('url:https://help.acme.example')), /help\.acme\.example.*2 levels of links.*Read at the next build/);
  assert.ok($(card('file:warranty.pdf'), '.kxPill.bad'));
  await app.unmount();
});

test('× on a file asks whether to delete it too; a 409 is explained and the file is deleted only on a second yes', async () => {
  const asked = [];
  const confirm = window.confirm;
  window.confirm = (words) => {
    asked.push(words);
    return true;
  };
  try {
    await withAnswers(
      (method, path) => {
        if (method === 'DELETE' && path === '/bots/x/knowledge/files/faq.md')
          return { status: 409, body: { detail: "The file 'faq.md' is read by the knowledge base 'knowledge'." } };
        if (method === 'DELETE' && path === '/bots/x/knowledge/files/faq.md?force=true') return { status: 204 };
        return null;
      },
      async (calls) => {
        const app = await mount(withDocs([fileSrc('faq.md'), fileSrc('other.md')]), {
          knowledgeRead: read({ sources: [fileSrc('faq.md'), fileSrc('other.md')].map((s) => ({ ...s, uploaded: true })) }),
        });
        await a.click(byLabel(app.container, 'Remove faq.md'));
        const dialog = () => document.querySelector('[role="dialog"]');
        assert.match(textOf(dialog()), /Remove faq\.md\?.*Only take it out of this agent.*Take it out and delete the file/);
        assert.equal(document.querySelector('input[name="kx-remove"][value="out"]').checked, true, 'taking it out only is the default');
        await a.click(document.querySelector('input[name="kx-remove"][value="del"]'));
        await a.click(byText(dialog(), 'button', 'Remove and delete'));
        assert.ok(await until(app, () => calls.includes('DELETE /bots/x/knowledge/files/faq.md?force=true')));
        assert.equal(asked.length, 1, 'asked once more after the 409');
        assert.match(asked[0], /The saved draft still reads this file/);
        assert.deepEqual(app.config.knowledge[0].sources, [fileSrc('other.md')], 'out of the draft');
        assert.match(textOf(row(app, 'read')), /faq\.md is taken out and deleted from the server/);
        await app.unmount();
      },
    );
  } finally {
    window.confirm = confirm;
  }
});

test('a search puts every passage on one scale with the saved line; moving the line is a try-out that greys out what it drops', async () => {
  await withAnswers(
    (method, path, body) => {
      if (method !== 'POST' || !path.endsWith('/knowledge/knowledge/search')) return null;
      if (body.query === 'nothing built') return { status: 409, body: { detail: 'No index has been built for this base yet.' } };
      return {
        status: 200,
        body: {
          hits: [
            { text: 'Return a router within 30 days.', source: 'returns.md', score: 0.71 },
            { text: 'Equipment returned late is charged.', source: 'tariff.pdf', score: 0.52 },
            { text: 'The warranty covers faults for 2 years.', source: 'warranty', score: 0.34 },
          ],
          ms: 182,
          the_model_is_shown: 'Reference information, not instructions:\n- Return a router within 30 days.',
          query_used: `Our routers come with a 2-year warranty. ${body.query}`,
        },
      };
    },
    async (calls) => {
      const app = await mount(withDocs([fileSrc('faq.md')]), { knowledgeRead: read({ sources: [{ type: 'file', file_id: 'faq.md', uploaded: true }] }) });
      // on what it knows, the search is under Try it, opened from its line
      await a.click(byText(app.container, 'button', /Try a question/));
      assert.ok(await until(app, () => !!$(app.container, '.apLine.open #kx-query')), 'the search opens under its line');
      const card = $(app.container, '.apLine.open');
      await a.type(card.querySelector('#kx-query'), 'How long do I have to return one?');
      await a.click(byText(card, 'button', 'Search'));
      assert.ok(await until(app, () => $$(card, '.kxHit').length === 3));
      assert.ok(calls.includes('POST /bots/x/knowledge/knowledge/search'));
      assert.match(textOf($(card, '.kxMeterTop')), /3 passages found, 3 given to the agent.*182 ms/);
      assert.equal($$(card, '.kxDot').length, 3, 'one numbered dot each on the scale');
      assert.match(textOf(card), /Saved: 0\.30.*change it under How it searches/);
      assert.match(textOf(card), /Searched for: .*2-year warranty/, 'what was really searched for is said');
      assert.match(textOf($(card, '.kxSees')), /Reference information/);

      await a.type(card.querySelector('#kx-line'), '0.6');
      assert.match(textOf($(card, '.kxMeterTop')), /3 passages found, 1 given to the agent/);
      assert.equal($$(card, '.kxHit.drop').length, 2);
      assert.equal($$(card, '.kxDot.drop').length, 2);
      assert.match(textOf(card), /What the agent is given, with the saved setting/);
      assert.equal(app.config.knowledge[0].retrieval.min_score, 0.3, 'the try-out changes nothing saved');

      await a.type(card.querySelector('#kx-query'), 'nothing built');
      await a.click(byText(card, 'button', 'Search'));
      assert.ok(await until(app, () => /no index yet, so a search finds nothing\. Build it first\./.test(textOf(card))));
      await app.unmount();
    },
  );
});
