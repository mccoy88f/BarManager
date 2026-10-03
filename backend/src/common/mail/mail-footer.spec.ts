import { buildMailFooter } from './mail-footer';

describe('buildMailFooter', () => {
  it('include nome, indirizzo — città, telefono/social (stesso ordine del footer del menù pubblico) e link privacy', () => {
    const footer = buildMailFooter(
      {
        name: 'Bar Test',
        menuAddress: 'Via Roma 1',
        city: 'Milano',
        menuPhone: '0212345678',
        menuInstagramUrl: 'https://instagram.com/bartest',
        menuFacebookUrl: 'https://facebook.com/bartest',
        menuWebsiteUrl: 'https://bartest.it',
      },
      'https://bartest.it/privacy?token=abc',
    );

    expect(footer.text).toContain('Bar Test');
    expect(footer.text).toContain('Via Roma 1');
    expect(footer.text).toContain('Milano');
    expect(footer.text).toContain('0212345678');
    expect(footer.text).toContain('Gestisci i tuoi dati personali: https://bartest.it/privacy?token=abc');

    expect(footer.html).toContain('Bar Test');
    expect(footer.html).toContain('Via Roma 1 — Milano');
    expect(footer.html).toContain('href="tel:0212345678"');
    expect(footer.html).toContain('href="https://instagram.com/bartest"');
    expect(footer.html).toContain('href="https://facebook.com/bartest"');
    expect(footer.html).toContain('href="https://bartest.it"');
    expect(footer.html).toContain('href="https://bartest.it/privacy?token=abc"');

    // Ordine: telefono, Instagram, Facebook, sito — stesso ordine della riga di icone del menù pubblico/ordini online.
    const phoneIdx = footer.html.indexOf('tel:0212345678');
    const instaIdx = footer.html.indexOf('instagram.com');
    const fbIdx = footer.html.indexOf('facebook.com');
    const siteIdx = footer.html.indexOf('bartest.it"');
    expect(phoneIdx).toBeLessThan(instaIdx);
    expect(instaIdx).toBeLessThan(fbIdx);
    expect(fbIdx).toBeLessThan(siteIdx);

    // Pulsanti rotondi (come il footer del menù pubblico/ordini online), non link testuali.
    expect(footer.html).toContain('border-radius:50%');
    expect(footer.html).not.toContain('>Instagram<');
    expect(footer.html).not.toContain('>Facebook<');
    expect(footer.html).not.toContain('>Sito web<');
  });

  it('omette ogni riga per cui il locale non ha dati, senza lasciare contenitori vuoti', () => {
    const footer = buildMailFooter({ name: 'Bar Minimo' }, null);

    expect(footer.text).toBe('\n---\nBar Minimo');
    expect(footer.html).not.toContain('tel:');
    expect(footer.html).not.toContain('Gestisci i tuoi dati personali');
    expect(footer.html).toContain('Bar Minimo');
  });

  it('non mostra il link privacy quando il cliente non ha ancora un token', () => {
    const footer = buildMailFooter({ name: 'Bar Test', city: 'Milano' }, null);

    expect(footer.text).not.toContain('Gestisci i tuoi dati personali');
    expect(footer.html).not.toContain('Gestisci i tuoi dati personali');
  });
});
