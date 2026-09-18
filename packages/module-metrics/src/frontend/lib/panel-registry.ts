import type { MetricPanel, MetricsPanelsService } from '../../contracts/index.js';

/** Реестр панелей, которые модули объявляют через сервис `metrics:panels`. */
export const metricsPanelsService: MetricsPanelsService = (() => {
  const panels: MetricPanel[] = [];
  return {
    register(panel) {
      const index = panels.findIndex(candidate => candidate.id === panel.id);
      if (index >= 0) panels[index] = panel;
      else panels.push(panel);
    },
    getAll() {
      return [...panels];
    },
  };
})();
