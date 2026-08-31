import Link from "next/link";
import { PlatformHeader } from "../components/platform-header";
import { TOOL_REGISTRY } from "../lib/tools/registry";

export default function Page() {
  return (
    <>
      <PlatformHeader />
      <main id="main" tabIndex={-1} className="platform-home">
        <section className="platform-intro" aria-labelledby="platform-title">
          <p className="eyebrow">FOREIGN VIDEO → NATURAL KOREAN SUBTITLE</p>
          <h1 id="platform-title">
            영상과 자막을 위한 <span>VIKO 도구 모음.</span>
          </h1>
          <p className="intro">
            외국어 영상에서 자연스러운 한국어 자막까지. Subtitle QA와
            Converter로 자막 검사와 SRT·VTT 변환을 내 기기에서 처리하세요.
          </p>
          <p className="intro">
            AI 번역·수정 및 다른 도구는 준비 중이며 아직 사용할 수 없습니다.
          </p>
        </section>
        <section aria-labelledby="tools-heading">
          <h2 id="tools-heading">도구 둘러보기</h2>
          <ul className="tool-grid">
            {TOOL_REGISTRY.map((tool) => (
              <li key={tool.id}>
                <article
                  className="panel tool-card"
                  aria-labelledby={`${tool.id}-title`}
                >
                  <span className={`tool-status ${tool.status}`}>
                    {tool.status === "available" ? "사용 가능" : "준비 중"}
                  </span>
                  <h3 id={`${tool.id}-title`}>{tool.name}</h3>
                  <p>{tool.description}</p>
                  <dl className="tool-formats">
                    <div>
                      <dt>입력</dt>
                      <dd>{tool.inputFormats.join(" · ")}</dd>
                    </div>
                    <div>
                      <dt>출력</dt>
                      <dd>
                        {tool.outputFormats.join(" · ")}
                        {tool.id === "subtitle-qa" ? " (화면)" : ""}
                      </dd>
                    </div>
                  </dl>
                  {tool.status === "available" ? (
                    <Link className="tool-start" href={tool.path}>
                      {tool.name} 시작 <span aria-hidden="true">→</span>
                    </Link>
                  ) : (
                    <p className="tool-unavailable">아직 사용할 수 없습니다.</p>
                  )}
                </article>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
