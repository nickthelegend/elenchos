"""Elenchos scan: deterministic checks for Solidity code that consumes zkVerify aggregation receipts.

Built on Slither's IR and data-dependency analysis. Every verdict here is deterministic; the LLM only explains.

Rules
  E1   VK_FROM_CALLER      the statement checked by verifyProofAggregation is built from a caller-supplied
                            verification key (any circuit's proof will pass)                         critical
  E1b  LEAF_FROM_CALLER    the caller passes the leaf itself (any verified statement will pass)        critical
  E3   NO_REPLAY_GUARD     the function that checks a receipt never records the statement/nullifier   high
  E4   UNGATED_ACTION      a function changes balances/supply without checking any receipt, in a
                            contract that otherwise consumes zkVerify receipts                        critical
  E6   DOMAIN_FROM_CALLER  the zkVerify domain id comes from the caller                               medium

Usage: python3 elenchos_scan.py <path-to-project-or-sol-file> [--json out.json]
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import asdict, dataclass

from slither import Slither
from slither.analyses.data_dependency.data_dependency import is_dependent
from slither.core.declarations import Function, SolidityFunction
from slither.slithir.operations import HighLevelCall, InternalCall, SolidityCall
from slither.slithir.variables import Constant

VERIFY_FN = "verifyProofAggregation"
VK_NAME = re.compile(r"(^|_)(vk|vkey|vkhash|verificationkey|verifyingkey)", re.I)
ACTION_FN = re.compile(r"^(_mint|mint|_transfer|transfer|transferFrom|safeTransfer|safeTransferFrom|_burn|send)$")
SUPPLY_VAR = re.compile(r"(balance|supply|minted|claimed)", re.I)


@dataclass
class Finding:
    rule: str
    severity: str
    title: str
    contract: str
    function: str
    file: str
    line: int
    evidence: str
    fix: str


# Standard token operations on the caller's own balance or allowance: never an E4 finding by themselves.
OWN_BALANCE_OPS = {"transfer", "transferFrom", "approve", "increaseAllowance", "decreaseAllowance", "burn", "safeTransferFrom"}
LIB_PATH = re.compile(r"(^|/)(lib|node_modules|dependencies)/")


def is_library_code(fn: Function) -> bool:
    m = fn.source_mapping
    return bool(m and LIB_PATH.search(m.filename.relative or m.filename.short or ""))


def src(node_or_fn) -> tuple[str, int]:
    """(absolute file path, first line). Printers make it relative to wherever they run (SARIF needs repo-relative)."""
    m = node_or_fn.source_mapping
    return ((m.filename.absolute or m.filename.short) if m else "?", (m.lines[0] if m and m.lines else 0))


def verify_calls(fn: Function):
    """(node, call) for every verifyProofAggregation call in fn, including via internal calls one level down."""
    out = []
    for node in fn.nodes:
        for ir in node.irs:
            if isinstance(ir, HighLevelCall) and getattr(ir.function, "name", None) == VERIFY_FN:
                out.append((fn, node, ir))
    return out


def reaches_verify(fn: Function, depth: int = 0) -> bool:
    if verify_calls(fn):
        return True
    if depth > 3:
        return False
    for node in fn.nodes:
        for ir in node.irs:
            if isinstance(ir, InternalCall) and isinstance(ir.function, Function) and reaches_verify(ir.function, depth + 1):
                return True
            if isinstance(ir, HighLevelCall) and isinstance(getattr(ir, "function", None), Function) and ir.function.contract == fn.contract:
                if reaches_verify(ir.function, depth + 1):
                    return True
    return False


def changes_balances(fn: Function) -> str | None:
    for node in fn.nodes:
        for ir in node.irs:
            if isinstance(ir, (InternalCall, HighLevelCall)) and ACTION_FN.match(getattr(ir.function, "name", "") or ""):
                return f"calls {ir.function.name}"
    for v in fn.state_variables_written:
        if SUPPLY_VAR.search(v.name):
            return f"writes {v.name}"
    return None


def writes_mapping_after_verify(fn: Function) -> bool:
    """A replay guard: some mapping/bool state is written in the function (or a callee) that checks a receipt."""
    for v in fn.all_state_variables_written():
        t = str(v.type)
        if "mapping" in t and not SUPPLY_VAR.search(v.name):
            return True
    return False


def scan(target: str) -> list[Finding]:
    sl = Slither(target)
    findings: list[Finding] = []
    for c in sl.contracts_derived:
        consumer_fns = [f for f in c.functions if f.is_implemented and verify_calls(f)]
        if not consumer_fns:
            continue
        for fn in consumer_fns:
            params = fn.parameters
            for _, node, ir in verify_calls(fn):
                file, line = src(node)
                domain, _agg, leaf = ir.arguments[0], ir.arguments[1], ir.arguments[2]
                # E1b: leaf straight from a parameter
                if leaf in params:
                    findings.append(Finding("E1b", "critical", "The caller supplies the leaf", c.name, fn.full_name, file, line,
                        f"`{leaf.name}` is a parameter and is passed to {VERIFY_FN} unchanged: any statement zkVerify ever verified will pass.",
                        "Rebuild the leaf on-chain from a pinned vkHash and the public inputs the function acts on."))
                else:
                    for p in params:
                        if is_dependent(leaf, p, fn) and (VK_NAME.search(p.name) or (str(p.type) == "bytes32" and "key" in p.name.lower())):
                            findings.append(Finding("E1", "critical", "Verification key comes from the caller", c.name, fn.full_name, file, line,
                                f"The leaf checked by {VERIFY_FN} depends on parameter `{p.name}` ({p.type}). An attacker passes the vkHash of any circuit they wrote and a real zkVerify receipt for it.",
                                "Pin the vkHash (immutable, set in the constructor) and build the statement from it. See PinnedZkVerifyConsumer."))
                # E6: domain from caller
                if isinstance(domain, Constant):
                    pass
                elif domain in params:
                    findings.append(Finding("E6", "medium", "zkVerify domain comes from the caller", c.name, fn.full_name, file, line,
                        f"`{domain.name}` is a parameter: the receipt may come from any aggregation domain.",
                        "Pin the domain id (immutable)."))
            # E3: no replay guard
            if not writes_mapping_after_verify(fn):
                file, line = src(fn)
                findings.append(Finding("E3", "high", "Receipts can be replayed", c.name, fn.full_name, file, line,
                    f"{fn.name} checks a receipt but records nothing (no statement or nullifier mapping is written), so the same receipt works again.",
                    "Record the statement hash (or a nullifier bound in the public inputs) and refuse it the second time."))
        # E4: balance-changing functions that never check a receipt
        for fn in c.functions:
            if not fn.is_implemented or fn.visibility not in ("public", "external") or fn.is_constructor or fn.view or fn.pure:
                continue
            if is_library_code(fn) or fn.name in OWN_BALANCE_OPS:
                continue  # dependency code (OpenZeppelin etc.) and holders moving their own tokens are not findings
            what = changes_balances(fn)
            if what and not reaches_verify(fn) and not fn.is_protected():
                file, line = src(fn)
                findings.append(Finding("E4", "critical", "Value moves without a proof", c.name, fn.full_name, file, line,
                    f"{fn.name} {what} but never reaches {VERIFY_FN}, in a contract that consumes zkVerify receipts. Anyone can call it.",
                    "Make the action depend on a receipt checked in the same transaction (call _consume first)."))
    # de-duplicate
    seen, unique = set(), []
    for f in findings:
        k = (f.rule, f.contract, f.function, f.line)
        if k not in seen:
            seen.add(k)
            unique.append(f)
    order = {"critical": 0, "high": 1, "medium": 2}
    return sorted(unique, key=lambda f: (order[f.severity], f.contract, f.line))


if __name__ == "__main__":
    target = sys.argv[1]
    out = scan(target)
    payload = {"target": target, "findings": [asdict(f) for f in out]}
    if "--json" in sys.argv:
        with open(sys.argv[sys.argv.index("--json") + 1], "w") as fh:
            json.dump(payload, fh, indent=2)
    for f in out:
        print(f"[{f.rule} {f.severity:8}] {f.contract}.{f.function}  {os.path.relpath(f.file)}:{f.line}\n    {f.evidence}\n    fix: {f.fix}")
    print(f"{len(out)} finding(s)")
