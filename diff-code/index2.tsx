import { $gt } from '@ssc-fe-common/context';
import { useForm } from '@ssc-fe-common/hooks';
import type { FieldType } from '@ssc-fe-common/types';
import React, { useMemo, useState } from 'react';
import { Button, Modal } from 'ssc-ui-react';
import { ProForm } from 'react-pro-components';

import type { FormModel } from './types';

const FormModalComponent: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [form] = useForm<FormModel>();

  const fields: FieldType<FormModel>[] = useMemo(() => [
    {
      label: $gt('Vehicle Number'), name: 'vehicle_number', type: 'input', required: true,
      ctrlProps: {
        placeholder: $gt('Please enter vehicle number'),
        allowClear: true,
      },
    },
    {
      label: $gt('Driver Name'), name: 'driver_name',
      type: 'input',
      required: true,
      ctrlProps: {
        placeholder: $gt('Please enter driver name'),
        allowClear: true,
      },
    },
    {
      label: $gt('Logistics Vendor'),
      name: 'logistics_vendor',
      type: 'input',
      required: false,
      ctrlProps: {
        placeholder: $gt('Please enter logistics vendor'),
        maxLength: 100,
        allowClear: true,
      },
    },
    {
      label: $gt('Task Type'),
      name: 'task_type',
      type: 'select',
      required: true,
      remark: $gt('Default value is Unload, not editable'),
      ctrlProps: {
        options: [{ label: $gt('Unload'), value: 'Unload' }],
        disabled: false,
        allowClear: true,
        placeholder: '',
      },
    },
    {
      label: $gt('Remark'),
      name: 'remark',
      type: 'textarea',
      required: false,
      ctrlProps: {
        placeholder: $gt('Please enter remark'),
        maxLength: 200,
        allowClear: true,
        rows: 3,
      },
    },
  ], []);

  const handleOpen = () => {
    setVisible(true);
  };

  const handleCancel = () => {
    setVisible(false);
    form.resetFields();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      console.log('Form values:', values);
      // TODO: Add API call here
      setVisible(false);
      form.resetFields();
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  return (
    <>
      <Button type="primary" onClick={handleOpen}>
        {$gt('Create Yard Task')}
      </Button>
      <Modal
        title={$gt('Create Yard Task')}
        visible={visible}
        onCancel={handleCancel}
        onOk={handleSubmit}
        width={500}
      >
        <ProForm
          form={form}
          fields={fields}
          layout="vertical"
        />
      </Modal>
    </>
  );
};

export default FormModalComponent;
