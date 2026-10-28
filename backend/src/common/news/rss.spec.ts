import { fetchHeadlines } from './rss';

describe('fetchHeadlines', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('estrae i titoli dagli <item>, gestendo CDATA ed entità HTML', async () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <title>Feed di prova</title>
        <item><title><![CDATA[Prima notizia & qualcosa]]></title></item>
        <item><title>Seconda notizia "importante"</title></item>
      </channel></rss>`;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => xml }) as never;

    // URL diverso da altri test per non pescare dalla cache in-memory condivisa dal modulo.
    const headlines = await fetchHeadlines('https://example.com/feed-a.xml');

    expect(headlines).toEqual(['Prima notizia & qualcosa', 'Seconda notizia "importante"']);
  });

  it('torna un elenco vuoto, senza lanciare, se il feed risponde con un errore HTTP', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' }) as never;

    await expect(fetchHeadlines('https://example.com/feed-b.xml')).resolves.toEqual([]);
  });

  it('torna un elenco vuoto, senza lanciare, se la richiesta va in errore di rete', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as never;

    await expect(fetchHeadlines('https://example.com/feed-c.xml')).resolves.toEqual([]);
  });

  it('rispetta il limite massimo di titoli richiesti', async () => {
    const items = Array.from({ length: 5 }, (_, i) => `<item><title>Notizia ${i}</title></item>`).join('');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => `<rss>${items}</rss>` }) as never;

    const headlines = await fetchHeadlines('https://example.com/feed-d.xml', 2);

    expect(headlines).toHaveLength(2);
  });
});
