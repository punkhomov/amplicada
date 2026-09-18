-- Клики собираются только с явно размеченных data-metrics элементов — объём мал,
-- поэтому по умолчанию собираем все клики (раньше 0.1, что выглядело как «не работает»).
alter table metrics.settings alter column sample_click_rate set default 1.0;

update metrics.settings set sample_click_rate = 1.0 where id = 'default' and sample_click_rate <= 0.1;
