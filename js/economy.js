// Cargo deliveries — a simple neutral counter (no money mechanics).
(function (Canal) {
  class Economy {
    constructor() { this.delivered = 0; }
    deliver() { this.delivered++; }
  }
  Canal.Economy = Economy;
})(window.Canal);
