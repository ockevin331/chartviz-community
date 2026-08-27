// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AnalysisProgress } from '../src/ui/components/AnalysisProgress';

afterEach(cleanup);

describe('AnalysisProgress', () => {
  it('shows only the latest three distinct public updates', () => {
    render(<AnalysisProgress
      language="en"
      progress={[
        'preparing',
        'reading_chart',
        'reviewing_clues',
        'reviewing_clues',
        'checking_signals',
        'preparing_result',
      ]}
      onCancel={() => undefined}
    />);

    expect(screen.queryByText('Preparing the analysis…')).toBeNull();
    expect(screen.queryByText('Reading the chart…')).toBeNull();
    expect(screen.getByText('Some market clues are taking shape…')).toBeTruthy();
    expect(screen.getByText('Checking key levels and trade conditions…')).toBeTruthy();
    expect(screen.getByText('Preparing your analysis…')).toBeTruthy();
  });

  it('uses the same abstract progress experience in Chinese', () => {
    render(<AnalysisProgress
      language="zh-CN"
      progress={['preparing', 'reading_chart', 'reviewing_clues']}
      onCancel={() => undefined}
    />);

    expect(screen.getByText('正在准备分析…')).toBeTruthy();
    expect(screen.getByText('正在解读图表…')).toBeTruthy();
    expect(screen.getByText('发现了一些值得关注的市场线索…')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/证据|模型|提示词|schema/i);
  });
});
