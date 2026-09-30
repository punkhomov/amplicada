/**
 * Vite-специфичные суффиксы импортов. Либа — frontend-only, сборщик приложения — Vite
 * (единственный бандлер платформы), поэтому воркеры Monaco подключаются через `?worker`,
 * а сам модуль Monaco грузится динамически — редактор попадает в бандл только при открытии.
 */
declare module '*?worker' {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}
