import React from 'react';
import { Target, BookOpen } from 'lucide-react';
import type { DashboardScoringMetrics, DashboardDemographics } from '../../../types/database';

interface ScoreAndInterestWidgetProps {
  scoring: DashboardScoringMetrics;
  demographics: DashboardDemographics;
}

export const ScoreAndInterestWidget: React.FC<ScoreAndInterestWidgetProps> = ({
  scoring,
  demographics,
}) => {
  const { distribution, thresholds, average_score } = scoring;
  const { course_interest } = demographics;

  const getScoreColor = (cat: string) => {
    switch (cat) {
      case 'very_hot':
        return 'bg-[#8a1c1c] text-white';
      case 'hot':
        return 'bg-[#e26363] text-white';
      case 'warm':
        return 'bg-amber-500 text-white';
      case 'cold':
        return 'bg-[#449bd5] text-white';
      default:
        return 'bg-slate-300 text-slate-700';
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 1. Score Distribution */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-[#08254f] text-[#449bd5] shadow-xs">
                <Target className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#08254f] font-heading">
                  Distribuição de Lead Score
                </h3>
                <p className="text-xs text-slate-500">
                  Faixas ativas de pontuação comercial (0–100)
                </p>
              </div>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
              SNAPSHOT
            </span>
          </div>

          <div className="mb-4 p-3.5 bg-[#f8fafc] rounded-xl border border-slate-200/80 flex items-center justify-between">
            <span className="text-xs text-slate-600 font-medium">Score Médio Geral</span>
            <span className="text-lg font-extrabold text-[#08254f] font-heading">{average_score.toFixed(1)} pts</span>
          </div>

          <div className="space-y-3">
            {distribution.map((band) => (
              <div key={band.category} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800 flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${getScoreColor(band.category)}`} />
                    {band.label}
                    {band.min_score !== null && (
                      <span className="text-slate-400 font-normal">
                        ({band.min_score}–{band.max_score} pts)
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#08254f]">{band.lead_count}</span>
                    <span className="text-slate-400 w-12 text-right">
                      {band.percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getScoreColor(
                      band.category
                    )}`}
                    style={{ width: `${Math.max(band.percentage, 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span>
            Thresholds dinâmicos: Cold (≤{thresholds.cold_max}), Warm ({thresholds.warm_min}–{thresholds.warm_max}), Hot ({thresholds.hot_min}–{thresholds.hot_max}), Very Hot (≥{thresholds.very_hot_min})
          </span>
        </div>
      </div>

      {/* 2. Course Interest Ranking */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-[#e1f0fb] text-[#125e95] shadow-xs">
                <BookOpen className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#08254f] font-heading">
                  Interesse Primário por Curso
                </h3>
                <p className="text-xs text-slate-500">
                  Distribuição de leads pelo curso de interesse declarado
                </p>
              </div>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#08254f]/5 text-[#08254f] border border-[#08254f]/15 uppercase tracking-wider">
              SNAPSHOT
            </span>
          </div>

          {course_interest.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              Nenhum interesse por curso registrado
            </div>
          ) : (
            <div className="space-y-3">
              {course_interest.slice(0, 7).map((c, idx) => (
                <div key={`${c.course_name}-${idx}`} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 truncate max-w-[200px]" title={c.course_name}>
                      {c.course_name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#08254f]">{c.lead_count}</span>
                      <span className="text-slate-400 w-12 text-right">
                        {c.percentage.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#449bd5] transition-all duration-500"
                      style={{ width: `${Math.max(c.percentage, 0)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-slate-100 text-[11px] text-slate-400">
          Rankeamento de volume declarado na admissão do lead
        </div>
      </div>
    </div>
  );
};
