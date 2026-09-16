import { cn, useApiClient, useQuery } from '@amplicada/platform-core/frontend';
import { Avatar, AvatarFallback } from '@amplicada/platform-core/frontend/ui/avatar';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@amplicada/platform-core/frontend/ui/card';
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@amplicada/platform-core/frontend/ui/carousel';
import { Progress } from '@amplicada/platform-core/frontend/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@amplicada/platform-core/frontend/ui/tabs';
import {
  ArrowRight,
  Award,
  BookOpen,
  CalendarDays,
  Clock3,
  Database,
  GraduationCap,
  Megaphone,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { type ComponentType, useEffect, useState } from 'react';

interface MeResponse {
  user: { id: string; login: string };
}

type Icon = ComponentType<{ className?: string }>;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function getTodayLabel(): string {
  const label = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function initials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

interface Slide {
  id: string;
  tag: string;
  title: string;
  description: string;
  action: string;
  icon: Icon;
  gradient: string;
}

const SLIDES: Slide[] = [
  {
    id: 'appraisal',
    tag: 'Оценка персонала',
    title: 'Цикл оценки 2026 открыт',
    description: 'Поставьте цели, пройдите самооценку и получите обратную связь руководителя до конца квартала.',
    action: 'Перейти к оценке',
    icon: Target,
    gradient: 'from-indigo-600 via-blue-600 to-sky-500',
  },
  {
    id: 'learning',
    tag: 'Обучение',
    title: 'Неделя продуктового обучения',
    description: 'Восемь новых курсов, живые вебинары с экспертами и библиотека материалов — всё в одном месте.',
    action: 'Смотреть курсы',
    icon: GraduationCap,
    gradient: 'from-violet-600 via-purple-600 to-fuchsia-500',
  },
  {
    id: 'survey',
    tag: 'Опросы',
    title: 'Опрос вовлечённости команды',
    description: 'Расскажите, как вам работается: анкета анонимная и занимает всего несколько минут.',
    action: 'Пройти опрос',
    icon: Megaphone,
    gradient: 'from-emerald-600 via-teal-600 to-cyan-500',
  },
];

interface Stat {
  id: string;
  label: string;
  value: string;
  delta: string;
  icon: Icon;
  iconClass: string;
}

const STATS: Stat[] = [
  {
    id: 'employees',
    label: 'Сотрудников',
    value: '248',
    delta: '+12 за месяц',
    icon: Users,
    iconClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
  {
    id: 'courses',
    label: 'Активных курсов',
    value: '36',
    delta: '8 новых',
    icon: BookOpen,
    iconClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  {
    id: 'progress',
    label: 'Пройдено обучения',
    value: '74%',
    delta: '+6% за неделю',
    icon: TrendingUp,
    iconClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  {
    id: 'rating',
    label: 'Средняя оценка',
    value: '4.6',
    delta: 'из 5.0',
    icon: Award,
    iconClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
];

type NewsFilter = 'all' | 'company' | 'learning' | 'hr';

interface NewsItem {
  id: string;
  category: string;
  filter: Exclude<NewsFilter, 'all'>;
  date: string;
  title: string;
  excerpt: string;
  author: string;
}

const NEWS: NewsItem[] = [
  {
    id: 'office',
    category: 'Компания',
    filter: 'company',
    date: '12 сентября',
    title: 'Открываем офис в Казани',
    excerpt: 'Новая площадка начнёт работу в октябре: 120 рабочих мест, переговорные и зона для обучения команд.',
    author: 'Анна Петрова',
  },
  {
    id: 'analytics-course',
    category: 'Обучение',
    filter: 'learning',
    date: '10 сентября',
    title: 'Запущен курс по продуктовой аналитике',
    excerpt: 'Шесть модулей, практика на реальных данных и финальный проект с разбором от руководителей направлений.',
    author: 'Игорь Соколов',
  },
  {
    id: 'appraisal-results',
    category: 'HR',
    filter: 'hr',
    date: '8 сентября',
    title: 'Итоги квартальной оценки',
    excerpt: 'Средняя оценка выросла до 4.6. Подробная статистика по подразделениям уже доступна в разделе отчётов.',
    author: 'Мария Волкова',
  },
  {
    id: 'offsite',
    category: 'Компания',
    filter: 'company',
    date: '5 сентября',
    title: 'Корпоративный выезд 2026',
    excerpt: 'Регистрация открыта до конца месяца. В программе — воркшопы, командные треки и вечерняя часть.',
    author: 'Дмитрий Орлов',
  },
  {
    id: 'course-library',
    category: 'Обучение',
    filter: 'learning',
    date: '2 сентября',
    title: 'Библиотека курсов пополнилась',
    excerpt: 'Добавили 12 записей вебинаров и подборку коротких уроков формата «за 10 минут» для быстрого старта.',
    author: 'Елена Крылова',
  },
];

const NEWS_FILTERS: { id: NewsFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'company', label: 'Компания' },
  { id: 'learning', label: 'Обучение' },
  { id: 'hr', label: 'HR' },
];

const NEWS_BADGE_VARIANT: Record<Exclude<NewsFilter, 'all'>, 'default' | 'secondary' | 'outline'> = {
  company: 'secondary',
  learning: 'default',
  hr: 'outline',
};

interface Course {
  id: string;
  title: string;
  meta: string;
  progress: number;
  icon: Icon;
  iconClass: string;
}

const COURSES: Course[] = [
  {
    id: 'safety',
    title: 'Охрана труда и безопасность',
    meta: 'Модуль 3 из 5',
    progress: 60,
    icon: ShieldCheck,
    iconClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
  {
    id: 'feedback',
    title: 'Навыки обратной связи',
    meta: 'Модуль 2 из 4',
    progress: 45,
    icon: MessagesSquare,
    iconClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  {
    id: 'analytics',
    title: 'Продуктовая аналитика',
    meta: 'Модуль 1 из 6',
    progress: 15,
    icon: Database,
    iconClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
];

interface UpcomingEvent {
  id: string;
  day: string;
  month: string;
  title: string;
  time: string;
}

const EVENTS: UpcomingEvent[] = [
  { id: 'goals', day: '18', month: 'сен', title: 'Встреча по целям Q4', time: '11:00, переговорная «Ладога»' },
  { id: 'webinar', day: '21', month: 'сен', title: 'Вебинар: сильная обратная связь', time: '16:00, онлайн' },
  { id: 'deadline', day: '30', month: 'сен', title: 'Дедлайн самооценки', time: 'до 23:59' },
];

function HeroCarousel() {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!api) return;
    setCurrent(api.selectedScrollSnap());
    const onSelect = () => setCurrent(api.selectedScrollSnap());
    api.on('select', onSelect);
    return () => {
      api.off('select', onSelect);
    };
  }, [api]);

  return (
    <div>
      <Carousel setApi={setApi} opts={{ loop: true }} className="w-full">
        <CarouselContent>
          {SLIDES.map(slide => {
            const Icon = slide.icon;
            return (
              <CarouselItem key={slide.id}>
                <div
                  className={cn('relative overflow-hidden rounded-xl bg-gradient-to-br p-6 text-white sm:px-16 sm:py-10', slide.gradient)}
                >
                  <div className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-white/10 blur-2xl" />
                  <div className="pointer-events-none absolute -bottom-20 left-1/3 size-48 rounded-full bg-black/10 blur-2xl" />
                  <Icon className="pointer-events-none absolute right-10 bottom-8 hidden size-28 text-white/15 sm:block" />
                  <div className="relative flex max-w-2xl flex-col items-start gap-3">
                    <Badge className="border-white/20 bg-white/15 text-white backdrop-blur-sm">
                      <Sparkles className="size-3" />
                      {slide.tag}
                    </Badge>
                    <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{slide.title}</h2>
                    <p className="text-sm text-white/80 sm:text-base">{slide.description}</p>
                    <Button className="mt-1 bg-white text-slate-900 hover:bg-white/90">
                      {slide.action}
                      <ArrowRight />
                    </Button>
                  </div>
                </div>
              </CarouselItem>
            );
          })}
        </CarouselContent>
        <CarouselPrevious className="left-4 hidden sm:inline-flex" />
        <CarouselNext className="right-4 hidden sm:inline-flex" />
      </Carousel>
      <div className="mt-3 flex justify-center gap-1.5">
        {SLIDES.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            aria-label={slide.title}
            aria-current={index === current}
            onClick={() => api?.scrollTo(index)}
            className={cn(
              'h-1.5 rounded-full transition-all',
              index === current ? 'w-6 bg-foreground' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50',
            )}
          />
        ))}
      </div>
    </div>
  );
}

function StatsGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {STATS.map(stat => {
        const Icon = stat.icon;
        return (
          <Card key={stat.id}>
            <CardContent className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">{stat.label}</span>
                <span className="text-2xl font-semibold tracking-tight">{stat.value}</span>
                <span className="text-xs text-muted-foreground">{stat.delta}</span>
              </div>
              <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', stat.iconClass)}>
                <Icon className="size-4" />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function NewsSection() {
  const [filter, setFilter] = useState<NewsFilter>('all');
  const items = filter === 'all' ? NEWS : NEWS.filter(item => item.filter === filter);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Новости компании</h2>
        <Tabs value={filter} onValueChange={value => setFilter(value as NewsFilter)}>
          <TabsList variant="line">
            {NEWS_FILTERS.map(item => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex flex-col gap-4">
        {items.map(item => (
          <Card key={item.id} className="transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Badge variant={NEWS_BADGE_VARIANT[item.filter]}>{item.category}</Badge>
                <span className="text-xs text-muted-foreground">{item.date}</span>
              </div>
              <h3 className="text-base leading-snug font-medium">{item.title}</h3>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{item.excerpt}</p>
            </CardContent>
            <CardFooter className="justify-between">
              <div className="flex items-center gap-2">
                <Avatar size="sm">
                  <AvatarFallback>{initials(item.author)}</AvatarFallback>
                </Avatar>
                <span className="text-xs text-muted-foreground">{item.author}</span>
              </div>
              <Button variant="ghost" size="sm">
                Читать
                <ArrowRight />
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}

function LearningSection() {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Обучение сотрудников</h2>
        <Button variant="ghost" size="sm">
          Все курсы
        </Button>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-5">
          {COURSES.map(course => {
            const Icon = course.icon;
            return (
              <div key={course.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', course.iconClass)}>
                    <Icon className="size-4" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{course.title}</span>
                    <span className="text-xs text-muted-foreground">{course.meta}</span>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">{course.progress}%</span>
                </div>
                <Progress value={course.progress} />
              </div>
            );
          })}
        </CardContent>
        <CardFooter>
          <Button className="w-full">
            Продолжить обучение
            <ArrowRight />
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}

function EventsSection() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Ближайшие события</h2>
      <Card>
        <CardContent className="flex flex-col gap-4">
          {EVENTS.map(event => (
            <div key={event.id} className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 flex-col items-center justify-center rounded-lg bg-muted">
                <span className="text-[10px] leading-none text-muted-foreground uppercase">{event.month}</span>
                <span className="text-sm leading-tight font-semibold">{event.day}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{event.title}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock3 className="size-3 shrink-0" />
                  {event.time}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

export function HomePage() {
  const api = useApiClient();
  const { data } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
  });

  const user = data?.user;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-8 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {getGreeting()}
              {user ? `, ${user.login}` : ''}
            </h1>
            <p className="text-muted-foreground">Вот что происходит в компании сегодня</p>
          </div>
          <Badge variant="outline" className="h-6 gap-1.5 px-2.5 text-xs">
            <CalendarDays className="size-3" />
            {getTodayLabel()}
          </Badge>
        </div>

        <HeroCarousel />
        <StatsGrid />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <NewsSection />
          </div>
          <div className="flex flex-col gap-6">
            <LearningSection />
            <EventsSection />
          </div>
        </div>
      </div>
    </div>
  );
}
