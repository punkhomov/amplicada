import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@amplicada/platform-core/frontend/ui/breadcrumb';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';

export interface BreadcrumbEntry {
  label: string;
  to?: string;
}

export function AdminBreadcrumbs({ items }: { items: BreadcrumbEntry[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <Fragment key={`${item.label}-${item.to ?? ''}`}>
              <BreadcrumbItem>
                {isLast || !item.to ? (
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<Link to={item.to} />}>{item.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
