# Signals and noise

A signal carries information; noise hides it. The energy is $E = \sum_n |x_n|^2$,
and a price of $5 and $6 is not math.

> A quotation, kept as a block quote.

- one item
- two items with `inline code`

1. first
2. second

## A worked equation

$$
\hat{x}(f) = \int_{-\infty}^{\infty} x(t)\, e^{-2\pi i f t}\, dt
$$

| Window | Main lobe | Side lobe |
|---|---|---|
| Rectangular | narrow | -13 dB |
| Hann | wider | -31 dB |

```python
def energy(xs):
    # every space is kept
    return sum(x * x for x in xs)
```

![A spectrum plot](figures/spectrum.png)

![A remote chart](https://example.org/chart.png)

See [the notes](notes.md) and [the source](https://example.org/source).

# Filters

Raw <b>HTML</b> is shown as text, not run.

![A filter diagram](figures/filter.svg)
