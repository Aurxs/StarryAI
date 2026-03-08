import {http, HttpResponse} from 'msw';

export const handlers = [
    http.get('*/api/v1/graphs', () =>
        HttpResponse.json({
            count: 0,
            items: [],
        }),
    ),
    http.post('*/api/v1/graphs/validate', async ({request}) => {
        const body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
            graph_id: body.graph_id ?? 'graph_for_tests',
            valid: true,
            issues: [],
        });
    }),
    http.get('*/api/v1/node-types', () =>
        HttpResponse.json({
            count: 2,
            items: [
                {
                    type_name: 'mock.input',
                    mode: 'async',
                },
                {
                    type_name: 'mock.output',
                    mode: 'async',
                },
            ],
        }),
    ),
    http.get('*/api/v1/secrets', () =>
        HttpResponse.json({
            count: 0,
            items: [],
        }),
    ),
    http.get('*/api/v1/runs/:runId', ({params}) =>
        HttpResponse.json({
            run_id: params.runId,
            graph_id: 'graph_for_tests',
            status: 'completed',
            created_at: 1_700_000_000.0,
            started_at: 1_700_000_001.0,
            ended_at: 1_700_000_002.0,
            stream_id: 'stream_for_tests',
            last_error: null,
            task_done: true,
            metrics: {},
            node_states: {},
            edge_states: [],
        }),
    ),
    http.all('*/api/v1/:path*', () =>
        HttpResponse.json(
            {
                message: 'not found',
            },
            {
                status: 404,
            },
        ),
    ),
];
