import { describe, expect, it, vi } from "vitest";
import {
  MutationDrain,
  MutationRejectedError,
} from "./mutation-drain.js";

describe("MutationDrain", () => {
  it("rejects new work and waits for every previously accepted mutation", async () => {
    const gate = new MutationDrain();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mutation = gate.run(async () => held);
    const drained = vi.fn();
    const draining = gate.stopAcceptingAndDrain().then(drained);

    await expect(gate.run(async () => undefined)).rejects.toBeInstanceOf(
      MutationRejectedError,
    );
    await Promise.resolve();
    expect(drained).not.toHaveBeenCalled();

    release();
    await mutation;
    await draining;
    expect(drained).toHaveBeenCalledOnce();
  });

  it("drains rejected mutations without rethrowing their failures", async () => {
    const gate = new MutationDrain();
    const mutation = gate.run(async () => {
      throw new Error("expected");
    });
    const rejected = expect(mutation).rejects.toThrow("expected");

    await expect(gate.stopAcceptingAndDrain()).resolves.toBeUndefined();
    await rejected;
  });
});
