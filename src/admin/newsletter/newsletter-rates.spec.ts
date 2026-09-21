import { deliveryRate } from './newsletter-rates';

describe('deliveryRate', () => {
  it('calcula a taxa quando há retorno do provedor', () => {
    expect(deliveryRate(90, 100)).toBe(90);
  });

  it('não tem taxa sem nada enviado', () => {
    expect(deliveryRate(0, 0)).toBeNull();
  });

  // Nenhum código escreve `emailsDelivered` hoje: zero aqui significa "não
  // medido", não "nada chegou". O legado copiava `emailsSent` no lugar e
  // reportava 100% de entrega em toda campanha.
  it('não reporta 0% quando ninguém mediu a entrega', () => {
    expect(deliveryRate(0, 10_000)).toBeNull();
  });

  it('arredonda para uma casa decimal', () => {
    expect(deliveryRate(1, 3)).toBe(33.3);
  });
});
