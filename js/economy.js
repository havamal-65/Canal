// Money, spending, and income tracking.
(function (Canal) {
  const C = Canal.CONFIG;

  class Economy {
    constructor() {
      this.money = C.START_MONEY;
      this.delivered = 0;
      this.spent = 0;
      this.earned = 0;
      this._recent = []; // {t, amount} delivery events for the income readout
    }

    canAfford(amount) { return this.money >= amount; }

    spend(amount, label) {
      if (this.money < amount) return false;
      this.money -= amount;
      this.spent += amount;
      return true;
    }

    refund(amount) { this.money += amount; }

    deliver() {
      this.money += C.CARGO_VALUE;
      this.earned += C.CARGO_VALUE;
      this.delivered++;
      this._recent.push({ t: performance.now(), amount: C.CARGO_VALUE });
    }

    // Earnings over the last 10s, expressed per minute.
    incomePerMin() {
      const now = performance.now();
      const cutoff = now - 10000;
      while (this._recent.length && this._recent[0].t < cutoff) this._recent.shift();
      let sum = 0;
      for (const e of this._recent) sum += e.amount;
      return Math.round(sum * 6);
    }
  }

  Canal.Economy = Economy;
})(window.Canal);
