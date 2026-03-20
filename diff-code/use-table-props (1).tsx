import { INIT_PAGINATION } from '@ssc-fe-common/const';
import { $gt } from '@ssc-fe-common/context';
import { useForm } from '@ssc-fe-common/hooks';
import type { FieldType,ExtendColumnProps } from '@ssc-fe-common/types';
import React, { useMemo, useState } from 'react';
import { ProTable } from 'react-pro-components';
import type { ProTableProps } from 'react-pro-components/typings/components/pro-table/types';
import { Button } from 'ssc-ui-react';
import { SorterValue } from 'ssc-ui-react/typings/components/table/types';

import { getSearchParams } from '../adapter';
import { getTableBasicList } from '../api';
import type { ColumnInfo, SearchModel } from '../types';

const useTableProps = () => {
  const [pagination, setPagination] = useState(INIT_PAGINATION);
  const [dataSource, setDataSource] = useState<ColumnInfo[]>([]);
  const [form] = useForm<SearchModel>();
  const [selectedRowKeys, setSelectedRowKeys] = useState<(string | number)[]>([]);
  const [sorterModel, setSorterModel] = useState<{ ctime: SorterValue | null }>({ ctime: null });

  const fields: Array<FieldType<SearchModel>> = useMemo(() => {
    const arr: Array<FieldType<SearchModel>> = [
      {
        label: $gt('Date'),
        type: 'rangepicker',
        name: 'create_time',
      },
      {
        label: $gt('Status'),
        type: 'select',
        name: 'status',
        ctrlProps: {
          options: [
            { label: $gt('Active'), value: 'active' },
            { label: $gt('Inactive'), value: 'inactive' },
          ],
        },
      },
    ];
    return arr;
  }, []);

  const columns: Array<ExtendColumnProps<ColumnInfo>> = useMemo(() => {
    const arr:Array<ExtendColumnProps<ColumnInfo>> = [
      {
        title: $gt('Date'),
        dataIndex: 'ctime',
        fieldConfig: {
          type: 'datepicker',
          ctrlProps: {
            format: 'YYYY-MM-DD',
          },
        },
        width: 160,
      },
      {
        title: $gt('Total Inbound New Sku Quota'),
        dataIndex: 'total_inbound_new_sku_quota',
        width: 180,
        fieldConfig: {
          type: 'inputNumber',
          ctrlProps: {
            precision: 0,
          },
        },
      },
      {
        title: $gt('Upstream Used New Qty'),
        dataIndex: 'upstream_used_new_qty',
        width: 180,
        fieldConfig: {
          type: 'inputNumber',
          ctrlProps: {
            precision: 0,
          },
        },
      },
      {
        title: $gt('Item Qty Buffer (%)'),
        dataIndex: 'item_qty_buffer',
        width: 160,
        fieldConfig: {
          type: 'inputNumber',
          ctrlProps: {
            precision: 2,
            suffix: '%',
          },
        },
      },
      {
        title: $gt('Total Inbound SKU Quota'),
        dataIndex: 'total_inbound_sku_quota',
        width: 180,
        fieldConfig: {
          type: 'inputNumber',
          ctrlProps: {
            precision: 0,
          },
        },
      },
      {
        title: $gt('Upstream Used SKU'),
        dataIndex: 'upstream_used_sku',
        width: 160,
        fieldConfig: {
          type: 'inputNumber',
          ctrlProps: {
            precision: 0,
          },
        },
      },
      {
        title: $gt('SKU Buffer (%)'),
        dataIndex: 'sku_buffer',
        width: 140,
        fieldConfig: {
          type: 'inputNumber',
          ctrlProps: {
            precision: 2,
            suffix: '%',
          },
        },
      },
    ];
    return arr;
  }, []);

  const handleCreate = () => {
    console.log('create');
  };

  const handleView = (record: ColumnInfo) => {
    console.log('view', record);
  };

  const fetchList = async(pager?: { current?: number; pageSize?: number }) => {
    try {
      const { current = INIT_PAGINATION.current, pageSize = INIT_PAGINATION.pageSize } = pager || {};
      const res = await getTableBasicList({
        ...getSearchParams(form.getFieldsValue()),
        pageno: current,
        count: pageSize,
      });
      setDataSource(res?.list || []);
      setPagination({ current, pageSize, total: res?.total || 0 });
    } catch (e) {
      console.error(e);
    }
  };

  const proTableProps: ProTableProps<SearchModel, ColumnInfo> = {
    simple: true,
    searchForm: {
      formProps: {
        form,
      },
      fields,
      footerProps: { showReset: true },
      columns: 3,
      startCollapseRows: 3,
    },
    operation: (
      <>
        <Button type="primary" onClick={handleCreate}>
          {$gt('Create')}
        </Button>
      </>
    ),
    massTool: {
      label: null,
      sticky: true,
      text: ProTable.formatText($gt('SKU Quota Records'), selectedRowKeys.length),
      button: (
        <></>
      ),
      buttonAlign: 'left',
    },
    table: {
      dataSource,
      actionColumn: {
        fixed: 'right',
        width: 100,
        actions: (record) => [
          { children: $gt('View'), onClick: () => handleView(record) },
        ],
      },
      rowKey: 'trip_id',
      pagination,
      scroll: { x: '100%' },
      sticky: {
        offsetHeader: -64,
        offsetScroll: 4,
      },
      columns,
      rowSelection: {
        selectedRowKeys,
        onChange: (newKeys: (string | number)[]) => setSelectedRowKeys(newKeys),
      },
    },
    fetchData: {
      fetcher: async(info) => {
        const { current = pagination.current, pageSize = pagination.pageSize } = info.pagination || {};
        await fetchList({ current, pageSize });
      },
      fetchOnMount: true,
      fetchOnFormChange: false,
      fetchOnFormReset: true,
      fetchOnFormSubmit: true,
      fetchOnTableChange: true,
    },
  };

  return { proTableProps };
};

export default useTableProps;
