"""受限 guard 表达式 → Z3（QF_LRA/LIA）。

文法：
  expr     := or_expr
  or_expr  := and_expr ('||' and_expr)*
  and_expr := unary ('&&' unary)*
  unary    := '!' unary | '(' expr ')' | comparison
  comparison := operand ('<'|'<='|'>'|'>='|'=='|'!=') operand
  operand  := IDENT | NUMBER

不走完整 FOL（TP §2.10.2 纠错点）：变量限 int/real，量词不支持。
同一文法同时服务于规则 guard 与流程 gateway 条件（数据感知仿真用
Python 求值模式，eval_with 传入具体赋值）。
"""
from __future__ import annotations

import re
from typing import Any

import z3

TOKEN_RE = re.compile(r"\s*(&&|\|\||<=|>=|==|!=|[!<>()]|[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)")


class GuardSyntaxError(ValueError):
    pass


def tokenize(text: str) -> list[str]:
    tokens, pos = [], 0
    while pos < len(text):
        m = TOKEN_RE.match(text, pos)
        if not m:
            raise GuardSyntaxError(f"无法解析：…{text[pos:pos+20]!r}")
        tokens.append(m.group(1))
        pos = m.end()
    return tokens


class _Parser:
    """构建一棵小 AST：('or'|'and', [children]) / ('not', child) / ('cmp', op, var, value)"""

    def __init__(self, tokens: list[str]):
        self.toks = tokens
        self.i = 0

    def peek(self) -> str | None:
        return self.toks[self.i] if self.i < len(self.toks) else None

    def eat(self, expect: str | None = None) -> str:
        tok = self.peek()
        if tok is None or (expect is not None and tok != expect):
            raise GuardSyntaxError(f"期望 {expect!r}，得到 {tok!r}")
        self.i += 1
        return tok

    def parse(self):
        node = self.or_expr()
        if self.peek() is not None:
            raise GuardSyntaxError(f"多余的 token：{self.peek()!r}")
        return node

    def or_expr(self):
        children = [self.and_expr()]
        while self.peek() == "||":
            self.eat()
            children.append(self.and_expr())
        return children[0] if len(children) == 1 else ("or", children)

    def and_expr(self):
        children = [self.unary()]
        while self.peek() == "&&":
            self.eat()
            children.append(self.unary())
        return children[0] if len(children) == 1 else ("and", children)

    def unary(self):
        if self.peek() == "!":
            self.eat()
            return ("not", self.unary())
        if self.peek() == "(":
            self.eat()
            node = self.or_expr()
            self.eat(")")
            return node
        return self.comparison()

    def comparison(self):
        left = self.eat()
        op = self.eat()
        if op not in ("<", "<=", ">", ">=", "==", "!="):
            raise GuardSyntaxError(f"非法比较算子：{op!r}")
        right = self.eat()
        return ("cmp", op, left, right)


def parse_guard(text: str):
    return _Parser(tokenize(text)).parse()


def _is_number(tok: str) -> bool:
    try:
        float(tok)
        return True
    except ValueError:
        return False


def to_z3(ast, variables: dict[str, Any]):
    """AST → z3 BoolRef。variables: 变量名 → z3 变量。"""
    kind = ast[0]
    if kind == "or":
        return z3.Or(*[to_z3(c, variables) for c in ast[1]])
    if kind == "and":
        return z3.And(*[to_z3(c, variables) for c in ast[1]])
    if kind == "not":
        return z3.Not(to_z3(ast[1], variables))
    _, op, left, right = ast

    def operand(tok):
        if _is_number(tok):
            return float(tok) if "." in tok else int(tok)
        if tok not in variables:
            raise GuardSyntaxError(f"未声明的变量：{tok!r}")
        return variables[tok]

    a, b = operand(left), operand(right)
    return {"<": lambda: a < b, "<=": lambda: a <= b, ">": lambda: a > b,
            ">=": lambda: a >= b, "==": lambda: a == b, "!=": lambda: a != b}[op]()


def eval_with(ast, assignment: dict[str, float]) -> bool:
    """数据感知仿真用：在具体赋值下求值 guard。"""
    kind = ast[0]
    if kind == "or":
        return any(eval_with(c, assignment) for c in ast[1])
    if kind == "and":
        return all(eval_with(c, assignment) for c in ast[1])
    if kind == "not":
        return not eval_with(ast[1], assignment)
    _, op, left, right = ast

    def operand(tok):
        if _is_number(tok):
            return float(tok)
        if tok not in assignment:
            raise GuardSyntaxError(f"赋值缺少变量：{tok!r}")
        return float(assignment[tok])

    a, b = operand(left), operand(right)
    return {"<": a < b, "<=": a <= b, ">": a > b,
            ">=": a >= b, "==": a == b, "!=": a != b}[op]


def make_z3_vars(var_specs: dict) -> tuple[dict[str, Any], list]:
    """按 RuleSet.variables 造 z3 变量与 domain 约束。"""
    zvars: dict[str, Any] = {}
    domain = []
    for name, spec in var_specs.items():
        typ = spec["type"] if isinstance(spec, dict) else spec.type
        lo = spec.get("min") if isinstance(spec, dict) else spec.min
        hi = spec.get("max") if isinstance(spec, dict) else spec.max
        lo_ex = (spec.get("min_exclusive", False) if isinstance(spec, dict)
                 else spec.min_exclusive)
        v = z3.Int(name) if typ == "int" else z3.Real(name)
        zvars[name] = v
        if lo is not None:
            domain.append(v > lo if lo_ex else v >= lo)
        if hi is not None:
            domain.append(v <= hi)
    return zvars, domain
