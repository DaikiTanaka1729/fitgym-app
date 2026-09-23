import { useEffect, useState } from "react";

// 画面が狭いかどうか
// ------------------------------------------------------------
// 管理画面はタブレット・PCの幅を想定して作っているが、
// 店頭ではスマートフォンから開くこともある。
// 一覧を表のまま出すと列が潰れて1文字ずつ折り返し、
// 右端の操作列が画面の外に出て押せなくなる。
// 狭いときは並べ方そのものを変えるため、ここで判定する。
//
// 画面の回転や分割表示にも追従させたいので、
// 初回だけでなく変化も拾う。
// ------------------------------------------------------------
export default function useNarrow(px = 720) {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < px
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${px - 1}px)`);
    const onChange = (e) => setNarrow(e.matches);
    setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [px]);

  return narrow;
}
