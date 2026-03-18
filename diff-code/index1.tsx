import { $gt } from '@ssc-fe-common/context';
import { useForm } from '@ssc-fe-common/hooks';
import type { FieldType } from '@ssc-fe-common/types';
import React, { useState } from 'react';
import { Button, Modal, Form, Input, Select, message } from 'ssc-ui-react';

import { createYardTask } from '../../api';
import type { FormModel } from './types';
import styles from './index.module.less';

const FormModalComponentdehbdh: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [form] = useForm<FormModel>();
  const [loading, setLoading] = useState(false);

  const fields: Array<FieldType<FormModel>> = [
    {
      label: $gt('Vehicle Number'),
      name: 'vehicle_number',
      type: 'input',
      required: true,
      ctrlProps: {
        placeholder: $gt('Please enter vehicle number'),
        allowClear: true,
      },
    },
    {
      label: $gt('Driver Name'),
      name: 'driver_name',
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
      ctrlProps: {
        options: [{ label: $gt('Unload'), value: 'Unload' }],
        placeholder: '',
        allowClear: true,
        disabled: false,
      },
      remark: $gt('Default value is Unload, not editable'),
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
  ];

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
      setLoading(true);
      await createYardTask(values);
      message.success($gt('Create successfully'));
      setVisible(false);
      form.resetFields();
    } catch (error) {
      console.error('Validation failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <Button type="primary" onClick={handleOpen}>
        {$gt('Create Yard Task')}
      </Button>
      <Modal
        width={500}
        title={$gt('Create Yard Task')}
        visible={visible}
        onCancel={handleCancel}
        onOk={handleSubmit}
        confirmLoading={loading}
        
      >
        <Form form={form} layout="vertical">
          {fields.map((field) => (
            <Form.Item
              key={field.name as string}
              label={field.label}
              name={field.name}
              rules={[
                {
                  required: field.required,
                  message: `${field.label} ${$gt('is required')}`,
                },
              ]}
              extra={field.remark}
            >
              {field.type === 'input' && <Input {...field.ctrlProps} />}
              {field.type === 'select' && <Select {...field.ctrlProps} />}
              {field.type === 'textarea' && <Input.TextArea {...field.ctrlProps} />}
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </div>
  );
};

export default FormModalComponentdehbdh;
