// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectMenu } from '../src/ui/components/SelectMenu';

afterEach(cleanup);

describe('SelectMenu', () => {
  it('renders grouped, descriptive model options without a native select', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const options = [
      {
        value: 'terra',
        label: 'openai/gpt-5.6-terra',
        group: 'OpenAI',
        description: 'Balanced quality and speed',
        badge: 'Recommended',
      },
      {
        value: 'flash',
        label: 'google/gemini-3.7-flash',
        group: 'Google',
        description: 'Fast with strong image understanding',
      },
    ] as const;

    render(<SelectMenu ariaLabel="Model" value="terra" options={options} onChange={onChange} />);

    expect(document.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveProperty('textContent', expect.stringContaining('openai/gpt-5.6-terra'));
    await user.click(screen.getByRole('combobox', { name: 'Model' }));

    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('Google')).toBeTruthy();
    expect(screen.getByText('Balanced quality and speed')).toBeTruthy();
    expect(screen.getByText('Recommended')).toBeTruthy();
    expect(screen.getByText('Fast with strong image understanding')).toBeTruthy();

    await user.click(screen.getByRole('option', { name: /google\/gemini-3\.7-flash/i }));
    expect(onChange).toHaveBeenCalledWith('flash');
    expect(screen.queryByRole('listbox', { name: 'Model' })).toBeNull();
  });
});
