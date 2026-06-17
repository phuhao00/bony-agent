"use client";

import { useTranslation } from "@/hooks/useTranslation";
import { useMemo, useState } from "react";
import {
  getArchitectureCopy,
  type ArchNodeKey,
} from "./copy";

export default function ArchitecturePage() {
  const { locale } = useTranslation();
  const C = useMemo(() => getArchitectureCopy(locale), [locale]);
  const [activeNode, setActiveNode] = useState<ArchNodeKey>(null);

  const toggle = (key: ArchNodeKey) =>
    setActiveNode((prev) => (prev === key ? null : key));

  return (
    <div className="page-canvas min-h-full overflow-y-auto bg-[var(--shell-bg)]">
      <div className="chrome-bar sticky top-0 z-10 flex items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
            {C.title}
          </h1>
          <p className="mt-0.5 text-sm text-[color:var(--label-secondary)]">
            {C.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-[color:var(--label-secondary)]">
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--nav-active-fill)] px-2 py-1 font-semibold text-[color:var(--accent)] ring-1 ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            {C.hintBadge}
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        <section>
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-[color:var(--label-secondary)]">
            {C.sections.requestFlow}
          </h2>
          <div className="card-surface overflow-x-auto rounded-2xl p-5">
            <div className="flex min-w-max items-stretch gap-0">
              {C.flowSteps.map((step, i) => (
                <div key={i} className="flex items-center">
                  <div className="flex min-w-[100px] flex-col items-center rounded-xl px-4 py-2 transition-colors hover:bg-[var(--nav-active-fill)]">
                    <span className="mb-1 text-2xl">{step.icon}</span>
                    <span className="text-center text-sm font-semibold leading-tight text-[color:var(--foreground)]">
                      {step.label}
                    </span>
                    <span className="mt-0.5 text-center text-[10px] text-[color:var(--label-secondary)]">
                      {step.sub}
                    </span>
                  </div>
                  {i < C.flowSteps.length - 1 && (
                    <div className="flex items-center px-1">
                      <div className="h-0.5 w-6 bg-gradient-to-r from-[color-mix(in_srgb,var(--foreground)_22%,transparent)] to-[color-mix(in_srgb,var(--foreground)_32%,transparent)]" />
                      <div className="h-0 w-0 border-y-4 border-y-transparent border-l-4 border-l-[color-mix(in_srgb,var(--foreground)_30%,transparent)]" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex flex-col gap-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[color:var(--label-secondary)]">
              {C.sections.systemLayers}
            </h2>
            <p className="text-xs text-[color:var(--label-secondary)]">{C.sections.detailHint}</p>
          </div>
          <div className="space-y-3">
            {C.mainLayers.map((layer) => {
              const isActive = activeNode === layer.key;
              return (
                <div
                  key={layer.key}
                  className={`overflow-hidden rounded-2xl border transition-all duration-200 ${
                    isActive
                      ? "border-[color:var(--accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
                      : "border-[color:var(--separator-subtle)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(layer.key)}
                    className="flex w-full items-center justify-between bg-[var(--chrome-rail-bg)] px-5 py-4 transition-colors hover:bg-[var(--nav-active-fill)]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{layer.icon}</span>
                      <div className="text-left">
                        <div className="text-base font-bold text-[color:var(--foreground)]">
                          {layer.title}
                        </div>
                        <div className="mt-0.5 text-xs text-[color:var(--label-secondary)]">
                          {layer.subtitle}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-[var(--nav-active-fill)] px-2 py-0.5 text-xs font-semibold text-[color:var(--accent)] ring-1 ring-[color:color-mix(in_srgb,var(--accent)_28%,transparent)]">
                        {C.componentsCount(layer.items.length)}
                      </span>
                      <svg
                        className={`h-4 w-4 text-[color:var(--label-secondary)] transition-transform duration-200 ${
                          isActive ? "rotate-180" : ""
                        }`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </div>
                  </button>

                  {isActive && (
                    <div className="border-t border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] px-5 py-4">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {layer.items.map((item, idx) => (
                          <div
                            key={idx}
                            className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2.5"
                          >
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              {item.path != null ? (
                                <code className="shrink-0 rounded bg-[var(--nav-active-fill)] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--accent)]">
                                  {item.path}
                                </code>
                              ) : null}
                              <span className="text-sm font-semibold text-[color:var(--foreground)]">
                                {item.label}
                              </span>
                            </div>
                            {item.detail != null && item.detail !== "" ? (
                              <p className="mt-2 text-xs leading-relaxed text-[color:var(--label-secondary)]">
                                {item.detail}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-[color:var(--label-secondary)]">
            {C.sections.microservices}
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {C.microLayers.map((layer) => {
              const isActive = activeNode === layer.key;
              return (
                <div
                  key={layer.key}
                  className={`cursor-pointer overflow-hidden rounded-2xl border transition-all duration-200 ${
                    isActive
                      ? "border-[color:var(--accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
                      : "border-[color:var(--separator-subtle)]"
                  }`}
                  onClick={() => toggle(layer.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(layer.key);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-center justify-between bg-[var(--chrome-rail-bg)] px-4 py-3 hover:bg-[var(--nav-active-fill)]">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{layer.icon}</span>
                      <div>
                        <div className="text-sm font-bold text-[color:var(--foreground)]">
                          {layer.title}
                        </div>
                        <div className="text-[11px] text-[color:var(--label-secondary)]">
                          {layer.subtitle}
                        </div>
                      </div>
                    </div>
                    <svg
                      className={`h-4 w-4 text-[color:var(--label-secondary)] transition-transform duration-200 ${
                        isActive ? "rotate-180" : ""
                      }`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </div>
                  {isActive && (
                    <div className="space-y-2 border-t border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] px-4 py-3">
                      {layer.items.map((item, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2"
                        >
                          <div className="text-xs font-semibold text-[color:var(--foreground)]">{item.label}</div>
                          {item.detail != null && item.detail !== "" ? (
                            <p className="mt-1.5 text-[11px] leading-relaxed text-[color:var(--label-secondary)]">
                              {item.detail}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-[color:var(--label-secondary)]">
            {C.sections.infra}
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            {C.bottomLayers.map((layer) => {
              const isActive = activeNode === layer.key;
              return (
                <div
                  key={layer.key}
                  className={`cursor-pointer overflow-hidden rounded-2xl border transition-all duration-200 ${
                    isActive
                      ? "border-[color:var(--accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
                      : "border-[color:var(--separator-subtle)]"
                  }`}
                  onClick={() => toggle(layer.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(layer.key);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-center justify-between bg-[var(--chrome-rail-bg)] px-4 py-3 hover:bg-[var(--nav-active-fill)]">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{layer.icon}</span>
                      <div>
                        <div className="text-sm font-bold text-[color:var(--foreground)]">
                          {layer.title}
                        </div>
                        <div className="text-[11px] text-[color:var(--label-secondary)]">
                          {layer.subtitle}
                        </div>
                      </div>
                    </div>
                    <svg
                      className={`h-4 w-4 text-[color:var(--label-secondary)] transition-transform duration-200 ${
                        isActive ? "rotate-180" : ""
                      }`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </div>
                  {isActive && (
                    <div className="space-y-2 border-t border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] px-4 py-3">
                      {layer.items.map((item, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2"
                        >
                          <div className="text-xs font-semibold text-[color:var(--foreground)]">{item.label}</div>
                          {item.detail != null && item.detail !== "" ? (
                            <p className="mt-1.5 text-[11px] leading-relaxed text-[color:var(--label-secondary)]">
                              {item.detail}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-[color:var(--label-secondary)]">
            {C.sections.techStack}
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {C.techStack.map((stack) => (
              <div key={stack.category} className="card-surface rounded-2xl p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-lg">{stack.icon}</span>
                  <span className="text-sm font-semibold text-[color:var(--foreground)]">
                    {stack.category}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {stack.techs.map((tech) => (
                    <span
                      key={tech}
                      className="rounded-lg bg-[var(--nav-active-fill)] px-2 py-1 text-xs font-medium text-[color:var(--foreground)] ring-1 ring-[color:var(--separator-subtle)]"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-[color:var(--label-secondary)]">
            {C.sections.scale}
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {C.stats.map((stat) => (
              <div key={stat.label} className="card-surface rounded-2xl p-4 text-center">
                <div className="mb-1 text-2xl">{stat.icon}</div>
                <div className="text-3xl font-black text-[color:var(--accent)]">
                  {stat.value}
                  {stat.unit ? (
                    <span className="ml-0.5 text-base font-medium">{stat.unit}</span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs font-medium text-[color:var(--label-secondary)]">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-[color:var(--label-secondary)]">
            {C.sections.tree}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {C.treePanels.map((panel) => (
              <div key={panel.title} className="card-surface overflow-hidden rounded-2xl">
                <div className="flex items-center gap-2 bg-[var(--nav-active-fill)] px-4 py-2.5 text-sm font-semibold text-[color:var(--foreground)]">
                  <span>{panel.icon}</span>
                  <span>{panel.title}</span>
                </div>
                <pre className="overflow-x-auto whitespace-pre px-4 py-4 font-mono text-xs leading-relaxed text-[color:var(--label-secondary)]">
                  {panel.code}
                </pre>
              </div>
            ))}
          </div>
        </section>

        <div className="h-8" />
      </div>
    </div>
  );
}
