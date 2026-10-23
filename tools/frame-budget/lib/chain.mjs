// The chain's pure parts: a queue file read into jobs, one a (experiment, tier), each job's time cap,
// and the command line. What runs them, and on which port, is `rig/chain.mjs`'s.

/** The jobs of a queue file: each experiment once per tier it names (`tier` or `tiers`; both tiers
 * when it names neither), in the file's order, each with the harness's arguments for it. Throws on
 * a job without a kebab-case name, a tier outside medium and high, or two jobs that would write the
 * same rows file. */
export function expandJobs(queue) {
  if (!queue || typeof queue.base !== "string") throw new Error("the queue needs a base URL (`base`)");
  if (!Array.isArray(queue.jobs) || queue.jobs.length === 0) throw new Error("the queue needs a `jobs` list");
  const jobs = [];
  for (const j of queue.jobs) {
    if (typeof j.name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(j.name)) throw new Error(`a job needs a kebab-case name, got ${JSON.stringify(j.name)}`);
    const tiers = j.tiers ?? (j.tier === undefined ? ["medium", "high"] : [j.tier]);
    for (const tier of tiers) {
      if (tier !== "medium" && tier !== "high") throw new Error(`${j.name}: tier is medium or high, not ${tier}`);
      const id = `${j.name}-${tier}`;
      if (jobs.some((k) => k.id === id)) throw new Error(`two jobs would write ${id}.jsonl`);
      const args = ["--base", j.base ?? queue.base, "--tier", tier, "--machine", j.machine ?? queue.machine ?? "g4dn.xlarge"];
      if (j.against !== undefined) args.push("--against", j.against);
      if (j.views !== undefined) args.push("--views", Array.isArray(j.views) ? j.views.join(",") : j.views);
      if (j.pairs !== undefined) args.push("--pairs", String(j.pairs));
      if (j.settle !== undefined) args.push("--settle", String(j.settle));
      if (j.shot) args.push("--shot");
      jobs.push({ id, name: j.name, tier, args, attempts: 0 });
    }
  }
  return jobs;
}

/** The minutes a job is given before it is killed, from the page loads it makes: views × pairs ×
 * sides (24 for an A/B experiment over 4 views), each allowed the world's readiness (up to 40 s on
 * the rig), the settle, the warm-up and sample (13 s) and 20 s of slack, plus 10 minutes. */
export function capMinutes(job, { viewsInSet = 7, settleS = 30 } = {}) {
  const after = (flag) => {
    const i = job.args.indexOf(flag);
    return i === -1 ? undefined : job.args[i + 1];
  };
  const views = after("--views") === undefined ? viewsInSet : after("--views").split(",").length;
  const pairs = after("--pairs") === undefined ? 3 : Number(after("--pairs"));
  const sides = job.args.includes("--against") ? 2 : 1;
  const settle = after("--settle") === undefined ? settleS : Number(after("--settle"));
  const perLoadS = 40 + settle + 13 + 20;
  return Math.ceil((views * pairs * sides * perLoadS) / 60) + 10;
}

/** The parsed command line of `rig/chain.mjs`. */
export function parseChainArgs(argv) {
  const o = { queue: undefined, ports: [], retries: 1, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--queue") o.queue = v();
    else if (a === "--ports") o.ports = v().split(",").map((p) => Number(p.trim()));
    else if (a === "--retries") o.retries = Number(v());
    else if (a === "--dry-run") o.dryRun = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (o.queue === undefined) throw new Error("--queue <file.json> is required");
  if (o.ports.length === 0 || o.ports.some((p) => !Number.isInteger(p) || p <= 0)) throw new Error("--ports needs one or more port numbers, comma-separated");
  if (!Number.isInteger(o.retries) || o.retries < 0) throw new Error("--retries is a whole number");
  return o;
}
