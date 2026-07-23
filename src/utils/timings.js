class Timings {
  constructor() {
    this.stages = {};
    this.startTime = Date.now();
  }

  start(stage) {
    this.stages[stage] = { start: Date.now() };
  }

  end(stage) {
    if (this.stages[stage]) {
      this.stages[stage].duration = Date.now() - this.stages[stage].start;
    }
  }

  toJSON() {
    const result = {};
    for (const [key, val] of Object.entries(this.stages)) {
      result[key] = val.duration || 0;
    }
    result.total = Date.now() - this.startTime;
    return result;
  }
}

module.exports = Timings;
