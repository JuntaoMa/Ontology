"""流程 IR → PM4Py PetriNet。

转换约定（与数据集 IR 纪律配套）：
- step        → 变迁（label=步骤名），统一入口库所 P_in(step)：多条入边汇入同一库所 = XOR-join；
- XOR gateway → 库所：多入边=XOR-join、多出边=XOR-split（token 二选一）；
- AND gateway → 静默变迁：每条入边独立库所（齐全才触发=AND-join）、
                每条出边独立库所（同时发token=AND-split）；
- step 至多一条出边（分支必须显式经 gateway），加载时断言；
- 全网单源 i（= start step 的入口库所）单汇 o（ends 汇入），构成 WF-net。

XOR-split 配 AND-join 的经典死锁（AC-P-DEADLOCK）在该映射下被忠实保留。
"""
from __future__ import annotations

from pm4py.objects.petri_net.obj import Marking, PetriNet
from pm4py.objects.petri_net.utils import petri_utils

from ..models import ProcessIR


def build_petri(ir: ProcessIR) -> tuple[PetriNet, Marking, Marking]:
    kinds = ir.node_kinds()

    out_edges: dict[str, list] = {}
    for e in ir.edges:
        out_edges.setdefault(e.from_, []).append(e)
    for s in ir.steps:
        if len(out_edges.get(s.id, [])) > 1:
            raise ValueError(f"step {s.id} 有多条出边——分支必须显式经 gateway")

    net = PetriNet(ir.process_id)
    trans: dict[str, PetriNet.Transition] = {}     # 节点 id → 变迁（step/AND）
    places: dict[str, PetriNet.Place] = {}         # 节点 id → 库所（XOR）/ step 入口库所

    for s in ir.steps:
        t = petri_utils.add_transition(net, name=f"t_{s.id}", label=s.name)
        trans[s.id] = t
        p_in = petri_utils.add_place(net, name=f"pin_{s.id}")
        places[s.id] = p_in
        petri_utils.add_arc_from_to(p_in, t, net)
    for g in ir.gateways:
        if g.type == "XOR":
            places[g.id] = petri_utils.add_place(net, name=f"xor_{g.id}")
        else:  # AND → 静默变迁
            trans[g.id] = petri_utils.add_transition(net, name=f"and_{g.id}", label=None)

    def src_of(node_id: str):
        """边的发出端：step→其变迁；XOR→其库所；AND→其变迁。"""
        return trans[node_id] if kinds[node_id] in ("step", "AND") else places[node_id]

    def sink_of(node_id: str):
        """边的接收端：step→其入口库所；XOR→其库所；AND→其变迁。"""
        return places[node_id] if kinds[node_id] in ("step", "XOR") else trans[node_id]

    aux = 0
    for e in ir.edges:
        u, v = src_of(e.from_), sink_of(e.to)
        u_is_place = isinstance(u, PetriNet.Place)
        v_is_place = isinstance(v, PetriNet.Place)
        if u_is_place and v_is_place:          # XOR→(step/XOR)：插静默变迁
            aux += 1
            s = petri_utils.add_transition(net, name=f"tau_{aux}", label=None)
            petri_utils.add_arc_from_to(u, s, net)
            petri_utils.add_arc_from_to(s, v, net)
        elif not u_is_place and not v_is_place:  # (step/AND)→AND：插库所（每边独立）
            aux += 1
            p = petri_utils.add_place(net, name=f"p_{aux}")
            petri_utils.add_arc_from_to(u, p, net)
            petri_utils.add_arc_from_to(p, v, net)
        else:
            petri_utils.add_arc_from_to(u, v, net)

    source = places[ir.start]                  # start 必须是 step（其入口库所即源）
    sink = petri_utils.add_place(net, name="sink")
    for end in ir.ends:
        petri_utils.add_arc_from_to(trans[end], sink, net)

    im, fm = Marking(), Marking()
    im[source] = 1
    fm[sink] = 1
    return net, im, fm
