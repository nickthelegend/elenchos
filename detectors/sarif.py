"""Turn Elenchos findings into SARIF 2.1.0 so GitHub code scanning shows them inline on a PR.

Usage: python3 sarif.py <path-to-project-or-sol-file> [--out elenchos.sarif]
"""
from __future__ import annotations

import json
import sys
from dataclasses import asdict

from elenchos_scan import Finding, scan

RULES = {
    "E1": ("VK from caller", "A zkVerify consumer builds the aggregation leaf from a caller-supplied verification key, so a proof of any circuit passes."),
    "E1b": ("Leaf from caller", "A zkVerify consumer passes the aggregation leaf straight from a parameter, so any verified statement passes."),
    "E3": ("No replay guard", "A zkVerify receipt is checked but never recorded, so the same receipt can be replayed."),
    "E4": ("Value moves without a proof", "A balance- or supply-changing function never checks a receipt in a contract that otherwise consumes zkVerify receipts."),
    "E6": ("Domain from caller", "The zkVerify domain id comes from the caller, so a receipt from any aggregation domain is accepted."),
}
LEVEL = {"critical": "error", "high": "error", "medium": "warning"}


def sarif(findings: list[Finding], target: str) -> dict:
    used = {f.rule for f in findings}
    rules = [{
        "id": rid, "name": RULES[rid][0],
        "shortDescription": {"text": RULES[rid][0]},
        "fullDescription": {"text": RULES[rid][1]},
        "defaultConfiguration": {"level": LEVEL["critical"] if rid in ("E1", "E1b", "E4") else "warning"},
        "helpUri": "https://github.com/nickthelegend/elenchos#rules",
    } for rid in sorted(used)]
    results = [{
        "ruleId": f.rule,
        "level": LEVEL[f.severity],
        "message": {"text": f"{f.title}. {f.evidence} Fix: {f.fix}"},
        "locations": [{"physicalLocation": {
            "artifactLocation": {"uri": f.file},
            "region": {"startLine": max(f.line, 1)},
        }}],
    } for f in findings]
    return {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [{
            "tool": {"driver": {
                "name": "Elenchos",
                "informationUri": "https://github.com/nickthelegend/elenchos",
                "version": "0.1.0",
                "rules": rules,
            }},
            "results": results,
        }],
    }


if __name__ == "__main__":
    target = sys.argv[1]
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None
    doc = sarif(scan(target), target)
    text = json.dumps(doc, indent=2)
    if out:
        with open(out, "w") as fh:
            fh.write(text)
        print(f"wrote {out}: {len(doc['runs'][0]['results'])} result(s)")
    else:
        print(text)
