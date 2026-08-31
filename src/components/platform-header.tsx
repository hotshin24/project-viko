import Link from "next/link";

export function PlatformHeader({ toolName }: { toolName?: string }) {
  return (
    <>
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="VIKO Localize 홈">
          VIKO<span>LOCALIZE</span>
        </Link>
        <span className="current-tool">{toolName ?? "도구 둘러보기"}</span>
        <span className="product-direction">
          Foreign Video <span aria-hidden="true">→</span> Natural Korean
          Subtitle
        </span>
      </header>
    </>
  );
}
