import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KPICard } from '@/components/kpi-card';

describe('KPICard', () => {
  it('renders title and value', () => {
    render(<KPICard title="Today's Sales" value="$1,234" />);
    expect(screen.getByText("Today's Sales")).toBeDefined();
    expect(screen.getByText('$1,234')).toBeDefined();
  });

  it('renders subtitle when provided', () => {
    render(<KPICard title="Labor Ratio" value="24.5%" subtitle="Target: 25%" />);
    expect(screen.getByText('Target: 25%')).toBeDefined();
  });

  it('renders positive change indicator', () => {
    render(<KPICard title="Sales" value="$500" change={5.3} />);
    expect(screen.getByText(/5\.3%/)).toBeDefined();
    expect(screen.getByText(/▲/)).toBeDefined();
  });

  it('renders negative change indicator', () => {
    render(<KPICard title="Sales" value="$500" change={-2.1} />);
    expect(screen.getByText(/2\.1%/)).toBeDefined();
    expect(screen.getByText(/▼/)).toBeDefined();
  });

  it('does not render change when not provided', () => {
    const { container } = render(<KPICard title="Score" value="8.2" />);
    expect(container.querySelector('[data-change]')).toBeNull();
  });
});
