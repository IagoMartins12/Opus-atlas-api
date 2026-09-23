import { PLANOS, desconto } from './seed-plan-pricing';

describe('seed-plan-pricing', () => {
  describe('desconto', () => {
    it('calcula o desconto do período a partir dos preços', () => {
      // 19,90 × 12 = 238,80; 199,90 sai 16,3% mais barato.
      expect(desconto(19.9, 199.9, 12)).toBe(16.3);
    });

    it('devolve zero quando não há desconto', () => {
      expect(desconto(10, 120, 12)).toBe(0);
    });

    it('devolve negativo se o período sair mais caro que o mensal', () => {
      // Guarda contra um preço digitado errado passar como "desconto".
      expect(desconto(10, 130, 12)).toBeLessThan(0);
    });
  });

  describe('tabela de preços', () => {
    it('cobre os três planos pagos, sem FREE', () => {
      expect(PLANOS.map((p) => p.planType)).toEqual([
        'PLUS',
        'MENTOR',
        'MAESTRO',
      ]);
    });

    it('mantém a mesma régua nos três: o anual sai por ~dez meses', () => {
      for (const plano of PLANOS) {
        const meses = plano.yearlyPrice / plano.monthlyPrice;
        expect(meses).toBeGreaterThan(9.9);
        expect(meses).toBeLessThan(10.1);
      }
    });

    it('ordena os planos do mais barato ao mais caro', () => {
      const mensais = PLANOS.map((p) => p.monthlyPrice);
      expect([...mensais].sort((a, b) => a - b)).toEqual(mensais);

      const anuais = PLANOS.map((p) => p.yearlyPrice);
      expect([...anuais].sort((a, b) => a - b)).toEqual(anuais);
    });

    it('nunca deixa um período mais longo sair mais caro que o anterior', () => {
      // Um semestral acima do anual faria o site vender o pacote errado.
      for (const plano of PLANOS) {
        expect(plano.quarterlyPrice).toBeLessThan(plano.biannualPrice);
        expect(plano.biannualPrice).toBeLessThan(plano.yearlyPrice);
      }
    });

    it('desconta mais conforme o período cresce', () => {
      for (const plano of PLANOS) {
        const tri = desconto(plano.monthlyPrice, plano.quarterlyPrice, 3);
        const sem = desconto(plano.monthlyPrice, plano.biannualPrice, 6);
        const ano = desconto(plano.monthlyPrice, plano.yearlyPrice, 12);

        expect(tri).toBeGreaterThan(0);
        expect(sem).toBeGreaterThan(tri);
        expect(ano).toBeGreaterThan(sem);
      }
    });

    it('preenche todos os períodos — nenhum preço pode ficar em zero', () => {
      // Com o campo nulo a API devolve R$ 0,00 no período, e a página exibe.
      for (const plano of PLANOS) {
        expect(plano.monthlyPrice).toBeGreaterThan(0);
        expect(plano.quarterlyPrice).toBeGreaterThan(0);
        expect(plano.biannualPrice).toBeGreaterThan(0);
        expect(plano.yearlyPrice).toBeGreaterThan(0);
      }
    });
  });
});
